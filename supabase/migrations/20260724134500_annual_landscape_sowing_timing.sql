create or replace function atlas.apply_annual_landscape_sowing_projection_v1()
returns trigger
language plpgsql
security definer
set search_path to 'atlas', 'public'
as $function$
declare
  v_profile atlas.crop_profiles%rowtype;
  v_profile_id uuid;
  v_context text;
  v_sow_date date;
  v_clear_date date;
  v_first_bloom_start date;
  v_first_bloom_end date;
  v_latest_useful_sow_date date;
  v_minimum_display_days integer;
  v_display_weeks_min integer;
  v_display_weeks_max integer;
  v_slack_days integer;
  v_urgency_key text;
  v_urgency_label text;
  v_sow_window_value text;
  v_first_bloom_value text;
  v_display_value text;
  v_clear_value text;
  v_lines jsonb;
begin
  if coalesce(new.task_type, '') not in ('sowing', 'seed_sowing', 'seed_starting', 'checklist_step')
     and lower(coalesce(new.title, '')) not like '%sow%'
     and lower(coalesce(new.metadata->>'work_rhythm', '')) not like '%seed sowing%'
  then
    return new;
  end if;

  v_profile_id := case
    when coalesce(new.metadata->>'crop_profile_id', '') ~* '^[0-9a-f-]{36}$'
      then (new.metadata->>'crop_profile_id')::uuid
    else null
  end;

  if v_profile_id is null and nullif(new.metadata->>'crop_profile_stable_key', '') is not null then
    select id into v_profile_id
    from atlas.crop_profiles
    where stable_key = new.metadata->>'crop_profile_stable_key'
    limit 1;
  end if;

  if v_profile_id is null then return new; end if;

  select * into v_profile
  from atlas.crop_profiles
  where id = v_profile_id;

  if v_profile.id is null then return new; end if;

  v_context := lower(coalesce(
    nullif(v_profile.metadata->>'timing_context', ''),
    nullif(v_profile.metadata->>'spacing_context', ''),
    nullif(v_profile.metadata->>'crop_role', ''),
    ''
  ));

  if lower(coalesce(v_profile.life_cycle, '')) <> 'annual'
     or v_context not in ('landscape', 'landscape_color')
  then
    return new;
  end if;

  if nullif(v_profile.metadata->>'clear_bed_month_day', '') is null then return new; end if;

  v_sow_date := coalesce(
    nullif(new.metadata->>'actual_sow_date', '')::date,
    new.due_date,
    current_date
  );

  v_clear_date := to_date(
    ((extract(year from v_sow_date)::integer
      + coalesce(nullif(v_profile.metadata->>'harvest_year_offset', '')::integer, 0))::text
      || '-' || (v_profile.metadata->>'clear_bed_month_day')),
    'YYYY-MM-DD'
  );

  v_first_bloom_start := case
    when v_profile.days_to_harvest_watch_min is null then null
    else v_sow_date + v_profile.days_to_harvest_watch_min
  end;
  v_first_bloom_end := case
    when coalesce(v_profile.days_to_harvest_watch_max, v_profile.days_to_harvest_watch_min) is null then null
    else v_sow_date + coalesce(v_profile.days_to_harvest_watch_max, v_profile.days_to_harvest_watch_min)
  end;

  v_minimum_display_days := greatest(
    1,
    coalesce(nullif(v_profile.metadata->>'minimum_useful_display_days', '')::integer, 21)
  );

  if v_profile.days_to_harvest_watch_max is not null then
    v_latest_useful_sow_date := v_clear_date
      - v_profile.days_to_harvest_watch_max
      - v_minimum_display_days;
  end if;

  if v_first_bloom_end is not null then
    v_display_weeks_min := greatest(0, floor((v_clear_date - v_first_bloom_end)::numeric / 7)::integer);
  end if;
  if v_first_bloom_start is not null then
    v_display_weeks_max := greatest(0, floor((v_clear_date - v_first_bloom_start)::numeric / 7)::integer);
  end if;

  v_slack_days := case
    when v_latest_useful_sow_date is null then null
    else v_latest_useful_sow_date - current_date
  end;

  if v_slack_days is null then
    v_urgency_key := 'timing_incomplete';
    v_urgency_label := 'Landscape timing incomplete';
  elsif v_slack_days < 0 then
    v_urgency_key := 'past_useful_window';
    v_urgency_label := 'Past the useful landscape sowing window';
  elsif v_slack_days <= 3 then
    v_urgency_key := 'sow_now';
    v_urgency_label := 'Sow now for useful color before frost';
  elsif v_slack_days <= 14 then
    v_urgency_key := 'sow_soon';
    v_urgency_label := 'Sow soon for useful color before frost';
  else
    v_urgency_key := 'window_open';
    v_urgency_label := 'Useful landscape sowing window is open';
  end if;

  v_sow_window_value := case
    when v_latest_useful_sow_date is null then 'Timing needed'
    when current_date <= v_latest_useful_sow_date then 'Now–' || to_char(v_latest_useful_sow_date, 'Mon FMDD')
    else 'Closed · ended ' || to_char(v_latest_useful_sow_date, 'Mon FMDD')
  end;

  v_first_bloom_value := case
    when v_first_bloom_start is null then 'Timing needed'
    when v_first_bloom_end is null or v_first_bloom_end = v_first_bloom_start then to_char(v_first_bloom_start, 'Mon FMDD')
    else to_char(v_first_bloom_start, 'Mon FMDD') || '–' || to_char(v_first_bloom_end, 'Mon FMDD')
  end;

  v_display_value := case
    when v_display_weeks_min is null or v_display_weeks_max is null then 'Timing needed'
    when v_display_weeks_min = v_display_weeks_max then v_display_weeks_min::text || ' weeks before frost'
    else v_display_weeks_min::text || '–' || v_display_weeks_max::text || ' weeks before frost'
  end;

  v_clear_value := 'At frost · ' || to_char(v_clear_date, 'Mon FMDD');
  v_lines := jsonb_build_array(
    'Projected sow window · ' || v_sow_window_value,
    'Projected first bloom · ' || v_first_bloom_value,
    'Projected display · ' || v_display_value,
    'Projected clear bed · ' || v_clear_value
  );

  new.metadata := (coalesce(new.metadata, '{}'::jsonb) - 'clear_bed_offset_days')
    || jsonb_build_object(
      'timing_context', 'landscape',
      'timing_basis', 'useful_display_before_first_frost',
      'minimum_useful_display_days', v_minimum_display_days,
      'projected_sow_window_start', v_sow_date::text,
      'latest_useful_sow_date', case when v_latest_useful_sow_date is null then null else v_latest_useful_sow_date::text end,
      'latest_safe_sow_date', case when v_latest_useful_sow_date is null then null else v_latest_useful_sow_date::text end,
      'projected_first_bloom_start', case when v_first_bloom_start is null then null else v_first_bloom_start::text end,
      'projected_first_bloom_end', case when v_first_bloom_end is null then null else v_first_bloom_end::text end,
      'projected_harvest_start', case when v_first_bloom_start is null then null else v_first_bloom_start::text end,
      'projected_harvest_end', case when v_first_bloom_end is null then null else v_first_bloom_end::text end,
      'projected_display_weeks_min', v_display_weeks_min,
      'projected_display_weeks_max', v_display_weeks_max,
      'projected_clear_bed_date', v_clear_date::text,
      'clear_bed_timing_basis', 'first_frost',
      'sowing_slack_days', v_slack_days,
      'sowing_urgency_key', v_urgency_key,
      'sowing_urgency_label', v_urgency_label,
      'projection_status', case
        when v_latest_useful_sow_date is not null and v_first_bloom_start is not null then 'complete'
        else 'incomplete'
      end,
      'projection_detail_lines', v_lines,
      'detail_lines', v_lines
    );

  return new;
end;
$function$;

drop trigger if exists trg_zz_apply_annual_landscape_sowing_projection_v1 on atlas.tasks;
create trigger trg_zz_apply_annual_landscape_sowing_projection_v1
before insert or update of due_date, task_type, title, metadata
on atlas.tasks
for each row
execute function atlas.apply_annual_landscape_sowing_projection_v1();

update atlas.crop_profiles
set metadata = coalesce(metadata, '{}'::jsonb)
    || jsonb_build_object(
      'timing_context', 'landscape',
      'minimum_useful_display_days', 21,
      'clear_bed_timing_basis', 'first_frost',
      'clear_bed_month_day', '11-10',
      'harvest_year_offset', 0
    ),
    clear_offset_days = null,
    updated_at = now()
where stable_key = 'zinnia_thumbelina_landscape';
