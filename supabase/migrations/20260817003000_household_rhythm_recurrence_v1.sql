begin;

create or replace function atlas.household_rhythm_cadence_interval_v1(p_cadence text)
returns interval
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select case lower(trim(coalesce(p_cadence, '')))
    when 'daily' then interval '1 day'
    when 'weekly' then interval '1 week'
    when 'every_5_weeks' then interval '5 weeks'
    else null
  end;
$$;

comment on function atlas.household_rhythm_cadence_interval_v1(text) is
  'Machine-readable household cadence grammar for Principal capacity. Supported recurring values: daily, weekly, every_5_weeks. Other values are left untouched.';

create or replace function atlas.roll_household_rhythm_windows_v1(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_step interval;
  v_local_start timestamp without time zone;
  v_local_end timestamp without time zone;
  v_next_start timestamptz;
  v_next_end timestamptz;
  v_steps integer;
  v_updated integer := 0;
  v_advanced_steps integer := 0;
  r record;
begin
  for r in
    select
      hr.id,
      hr.cadence_rule,
      hr.next_window_start,
      hr.next_window_end,
      h.timezone
    from atlas.household_rhythms hr
    join atlas.households h on h.id = hr.household_id
    where hr.active
      and h.status = 'active'
      and hr.next_window_start is not null
      and hr.next_window_end is not null
      and hr.next_window_end < v_as_of
      and atlas.household_rhythm_cadence_interval_v1(hr.cadence_rule) is not null
    order by hr.next_window_end, hr.id
    for update of hr
  loop
    v_step := atlas.household_rhythm_cadence_interval_v1(r.cadence_rule);
    v_local_start := r.next_window_start at time zone r.timezone;
    v_local_end := r.next_window_end at time zone r.timezone;
    v_steps := 0;

    loop
      v_local_start := v_local_start + v_step;
      v_local_end := v_local_end + v_step;
      v_next_start := v_local_start at time zone r.timezone;
      v_next_end := v_local_end at time zone r.timezone;
      v_steps := v_steps + 1;

      if v_next_end >= v_as_of then
        exit;
      end if;

      if v_steps >= 4000 then
        raise exception 'Household rhythm % exceeded recurrence advancement safety limit.', r.id
          using errcode = '54000';
      end if;
    end loop;

    update atlas.household_rhythms hr
    set
      next_window_start = v_next_start,
      next_window_end = v_next_end,
      updated_at = now(),
      metadata = coalesce(hr.metadata, '{}'::jsonb) || jsonb_build_object(
        'lastCadenceAdvanceAt', v_as_of,
        'lastCadenceAdvanceSteps', v_steps,
        'lastCadenceAdvanceSource', 'household_rhythm_tick_v1'
      )
    where hr.id = r.id;

    v_updated := v_updated + 1;
    v_advanced_steps := v_advanced_steps + v_steps;
  end loop;

  return jsonb_build_object(
    'contractVersion', 'household_rhythm_roll_v1',
    'asOf', v_as_of,
    'updatedRhythms', v_updated,
    'advancedWindows', v_advanced_steps
  );
end;
$$;

comment on function atlas.roll_household_rhythm_windows_v1(timestamptz) is
  'Advances expired recognized household rhythm windows in household-local wall-clock time so DST does not shift the intended local hour.';

create or replace function atlas.household_rhythm_tick_v1()
returns jsonb
language sql
security definer
set search_path = pg_catalog, atlas
as $$
  select atlas.roll_household_rhythm_windows_v1(now());
$$;

comment on function atlas.household_rhythm_tick_v1() is
  'Clock tick that keeps recurring household capacity windows current even when no Principal UI is opened.';

revoke all on function atlas.household_rhythm_cadence_interval_v1(text) from public, anon, authenticated;
revoke all on function atlas.roll_household_rhythm_windows_v1(timestamptz) from public, anon, authenticated;
revoke all on function atlas.household_rhythm_tick_v1() from public, anon, authenticated;
grant execute on function atlas.household_rhythm_cadence_interval_v1(text) to service_role;
grant execute on function atlas.roll_household_rhythm_windows_v1(timestamptz) to service_role;
grant execute on function atlas.household_rhythm_tick_v1() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'atlas-household-rhythm-clock-v1') then
    perform cron.unschedule('atlas-household-rhythm-clock-v1');
  end if;

  perform cron.schedule(
    'atlas-household-rhythm-clock-v1',
    '37 * * * *',
    'select atlas.household_rhythm_tick_v1();'
  );
end;
$$;

commit;
