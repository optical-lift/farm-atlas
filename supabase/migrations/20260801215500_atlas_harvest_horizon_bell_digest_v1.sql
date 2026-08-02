-- Bell gets one farm-level movement notice; Harvest retains the detailed crop waves.

create or replace function atlas.harvest_horizon_tick_v1(
  p_farm_id uuid default null,
  p_as_of date default (now() at time zone 'America/Chicago')::date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_farm record;
  v_event_id uuid;
  v_event_key text;
  v_inserted integer := 0;
  v_as_of date := coalesce(p_as_of, (now() at time zone 'America/Chicago')::date);
begin
  for v_farm in
    with announced_cycles as (
      select distinct cycle_id::uuid as crop_cycle_id
      from atlas.journal_event_index event
      cross join lateral jsonb_array_elements_text(coalesce(event.payload -> 'cropCycleIds', '[]'::jsonb)) cycle_id
      where event.source_event = 'harvest_horizon_digest'
        and event.payload ->> 'surface' = 'harvest_horizon'
    ), horizon as (
      select
        forecast.farm_id,
        farm.organization_id,
        forecast.crop_cycle_id,
        forecast.object_id,
        coalesce(nullif(forecast.object_label, ''), 'Growing area') as object_label,
        coalesce(
          nullif(forecast.crop_profile_stable_key, ''),
          regexp_replace(lower(coalesce(nullif(forecast.crop_label, ''), 'crop')), '[^a-z0-9]+', '_', 'g')
        ) as crop_key,
        coalesce(nullif(forecast.crop_label, ''), 'Crop') as crop_label,
        nullif(forecast.variety, '') as variety,
        forecast.expected_harvest_watch_start as window_start,
        coalesce(forecast.expected_harvest_watch_end, forecast.expected_harvest_watch_start + 21) as window_end
      from atlas.crop_cycle_yield_forecast forecast
      join atlas.farms farm on farm.id = forecast.farm_id
      left join announced_cycles announced on announced.crop_cycle_id = forecast.crop_cycle_id
      where forecast.lifecycle_status = 'active'
        and forecast.expected_harvest_watch_start is not null
        and forecast.expected_harvest_watch_start <= v_as_of + 21
        and coalesce(forecast.expected_harvest_watch_end, forecast.expected_harvest_watch_start + 21) >= v_as_of
        and (p_farm_id is null or forecast.farm_id = p_farm_id)
        and coalesce(forecast.object_stable_key, '') not like 'grow_room_%'
        and lower(coalesce(forecast.cycle_state, '')) not in ('failed', 'cleared', 'finished', 'finished_harvest')
        and announced.crop_cycle_id is null
    ), decorated as (
      select
        horizon.*,
        crop_key || ':' || regexp_replace(lower(coalesce(variety, 'general')), '[^a-z0-9]+', '_', 'g') || ':' ||
          window_start::text || ':' || window_end::text as wave_key,
        coalesce(variety, crop_label) as crop_display
      from horizon
    )
    select
      farm_id,
      organization_id,
      (array_agg(crop_cycle_id order by crop_cycle_id::text))[1] as source_cycle_id,
      (array_agg(object_id order by object_label, object_id::text) filter (where object_id is not null))[1] as source_object_id,
      array_agg(crop_cycle_id order by crop_cycle_id::text) as crop_cycle_ids,
      array_agg(distinct object_label order by object_label) as object_labels,
      array_agg(distinct crop_display order by crop_display) as crop_labels,
      count(distinct wave_key)::integer as wave_count,
      min(window_start) as earliest_start,
      max(window_end) as latest_end
    from decorated
    group by farm_id, organization_id
  loop
    v_event_key := 'harvest-horizon-digest:' || v_as_of::text;

    v_event_id := atlas.upsert_journal_event_v1(
      p_organization_id => v_farm.organization_id,
      p_farm_id => v_farm.farm_id,
      p_event_key => v_event_key,
      p_event_kind => 'production_change',
      p_source_kind => 'crop_cycle',
      p_source_id => v_farm.source_cycle_id,
      p_source_event => 'harvest_horizon_digest',
      p_occurred_at => make_timestamptz(
        extract(year from v_as_of)::integer,
        extract(month from v_as_of)::integer,
        extract(day from v_as_of)::integer,
        6, 0, 0,
        'America/Chicago'
      ),
      p_journal_date => v_as_of,
      p_title => v_farm.wave_count::text || case when v_farm.wave_count = 1 then ' crop wave entered Harvest' else ' crop waves entered Harvest' end,
      p_detail => array_to_string(v_farm.crop_labels, ' · ') ||
        ' · ' || to_char(v_farm.earliest_start, 'Mon FMDD') ||
        '–' || to_char(v_farm.latest_end, 'Mon FMDD'),
      p_visibility_scope => 'farm_shared',
      p_importance => 'attention',
      p_object_id => v_farm.source_object_id,
      p_crop_cycle_id => v_farm.source_cycle_id,
      p_payload => jsonb_build_object(
        'deepLink', '/harvest',
        'surface', 'harvest_horizon',
        'digest', true,
        'waveCount', v_farm.wave_count,
        'earliestStart', v_farm.earliest_start,
        'latestEnd', v_farm.latest_end,
        'cropCycleIds', to_jsonb(v_farm.crop_cycle_ids),
        'cropLabels', to_jsonb(v_farm.crop_labels),
        'objectLabels', to_jsonb(v_farm.object_labels),
        'timeClaimsPhysicalCondition', false
      ),
      p_provenance => jsonb_build_object(
        'contractVersion', 'harvest_horizon_digest_v1',
        'source', 'crop_cycle_yield_forecast',
        'grouping', 'new_horizon_cycles_by_farm'
      )
    );

    if v_event_id is not null then v_inserted := v_inserted + 1; end if;
  end loop;

  return jsonb_build_object(
    'contractVersion', 'harvest_horizon_digest_v1',
    'asOf', v_as_of,
    'farmId', p_farm_id,
    'newFarmDigests', v_inserted
  );
end;
$function$;

create or replace function atlas.bell_event_deep_link_v1(p_event_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_event atlas.journal_event_index%rowtype;
  v_object_id uuid;
  v_object_key text;
  v_task_id uuid;
begin
  select event.* into v_event
  from atlas.journal_event_index event
  where event.id = p_event_id;
  if v_event.id is null then return '/bell'; end if;

  if v_event.source_event in ('harvest_horizon_entry', 'harvest_horizon_digest')
     or v_event.payload ->> 'surface' = 'harvest_horizon'
  then
    return '/harvest';
  end if;

  v_task_id := coalesce(
    v_event.task_id,
    atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'taskId'),
    atlas.rhythm_safe_uuid_v1(v_event.payload #>> '{task,taskId}')
  );
  if v_task_id is not null then
    return '/task-focus/' || v_task_id::text || '?returnTo=%2Fbell';
  end if;

  if v_event.project_id is not null then
    return '/project/' || v_event.project_id::text;
  end if;

  v_object_id := coalesce(
    v_event.object_id,
    case when v_event.payload ->> 'subjectKind' = 'growing_object'
      then atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'subjectId') else null end
  );
  if v_object_id is not null then
    select stable_key into v_object_key from atlas.growing_objects where id = v_object_id;
    if v_object_key is not null then return '/objects/' || v_object_key; end if;
  end if;

  return '/journal?date=' || v_event.journal_date::text || '#event-' || v_event.id::text;
end;
$function$;

create or replace function atlas.bell_event_why_v2(p_event_id uuid, p_effective_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_event atlas.journal_event_index%rowtype;
begin
  select event.* into v_event from atlas.journal_event_index event where event.id = p_event_id;
  if v_event.id is null then return 'Atlas recorded a meaningful change connected to work visible to this account.'; end if;

  if v_event.source_event in ('harvest_horizon_entry', 'harvest_horizon_digest')
     or v_event.payload ->> 'surface' = 'harvest_horizon'
  then
    return 'One or more crop waves entered the next 21 days, so they now belong in Harvest planning rather than the daily Work list.';
  end if;
  if v_event.event_kind = 'rhythm_warning' then return 'This rhythm is approaching its next boundary, so Atlas is giving the responsible account time to place the work before it becomes due.'; end if;
  if v_event.event_kind = 'rhythm_due' then return 'Atlas expected this rhythm to renew by now, but no completed work or acceptable observation was recorded.'; end if;
  if v_event.event_kind = 'rhythm_failure' then return 'This rhythm crossed its failure boundary after its last completed work or accepted observation.'; end if;
  if v_event.event_kind = 'owner_decision' then return 'A decision or problem handoff reached the Owner or manager responsible for the next move.'; end if;
  if v_event.event_kind = 'unlock' then return 'A dependency cleared and made a next move available.'; end if;
  if v_event.event_kind in ('task_result', 'maintenance_result') then
    if v_event.assigned_user_id = p_effective_user_id then return 'A result changed work assigned to this account.'; end if;
    return 'Another player changed work in a farm or project visible to this account.';
  end if;
  if v_event.event_kind = 'production_change' then return 'A production state changed in a way Atlas considers meaningful to the selected account.'; end if;
  return 'Atlas recorded a meaningful change connected to work visible to this account.';
end;
$function$;

-- The first implementation was applied only minutes before this consolidation and
-- had not yet become durable farm history. Replace those per-wave items with one digest.
delete from atlas.journal_event_index
where source_event = 'harvest_horizon_entry'
  and payload ->> 'surface' = 'harvest_horizon';

select atlas.harvest_horizon_tick_v1();
