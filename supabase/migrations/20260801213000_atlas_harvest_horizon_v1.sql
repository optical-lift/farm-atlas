-- Harvest Horizon v1
-- Forecast state lives in Harvest; Work receives only real harvest, clearing, or decision work.

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
  v_wave record;
  v_event_id uuid;
  v_inserted integer := 0;
  v_as_of date := coalesce(p_as_of, (now() at time zone 'America/Chicago')::date);
begin
  for v_wave in
    with horizon as (
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
        coalesce(
          forecast.expected_harvest_watch_end,
          forecast.expected_harvest_watch_start + 21
        ) as window_end
      from atlas.crop_cycle_yield_forecast forecast
      join atlas.farms farm on farm.id = forecast.farm_id
      where forecast.lifecycle_status = 'active'
        and forecast.expected_harvest_watch_start is not null
        and forecast.expected_harvest_watch_start <= v_as_of + 21
        and coalesce(forecast.expected_harvest_watch_end, forecast.expected_harvest_watch_start + 21) >= v_as_of
        and (p_farm_id is null or forecast.farm_id = p_farm_id)
        and coalesce(forecast.object_stable_key, '') not like 'grow_room_%'
        and lower(coalesce(forecast.cycle_state, '')) not in ('failed', 'cleared', 'finished', 'finished_harvest')
    )
    select
      farm_id,
      organization_id,
      crop_key,
      min(crop_label) as crop_label,
      variety,
      window_start,
      window_end,
      (array_agg(crop_cycle_id order by crop_cycle_id::text))[1] as source_cycle_id,
      (array_agg(object_id order by object_label, object_id::text) filter (where object_id is not null))[1] as source_object_id,
      array_agg(crop_cycle_id order by crop_cycle_id::text) as crop_cycle_ids,
      array_agg(distinct object_label order by object_label) as object_labels,
      count(*)::integer as cycle_count
    from horizon
    group by farm_id, organization_id, crop_key, variety, window_start, window_end
  loop
    v_event_id := atlas.upsert_journal_event_v1(
      p_organization_id => v_wave.organization_id,
      p_farm_id => v_wave.farm_id,
      p_event_key => left(
        'harvest-horizon:' || v_wave.crop_key || ':' ||
        regexp_replace(lower(coalesce(v_wave.variety, 'general')), '[^a-z0-9]+', '_', 'g') || ':' ||
        v_wave.window_start::text || ':' || v_wave.window_end::text,
        240
      ),
      p_event_kind => 'production_change',
      p_source_kind => 'crop_cycle',
      p_source_id => v_wave.source_cycle_id,
      p_source_event => 'harvest_horizon_entry',
      p_occurred_at => make_timestamptz(
        extract(year from v_as_of)::integer,
        extract(month from v_as_of)::integer,
        extract(day from v_as_of)::integer,
        6, 0, 0,
        'America/Chicago'
      ),
      p_journal_date => v_as_of,
      p_title => coalesce(v_wave.variety, v_wave.crop_label) || ' entered the harvest horizon',
      p_detail => array_to_string(v_wave.object_labels, ' · ') ||
        ' · expected ' || to_char(v_wave.window_start, 'Mon FMDD') ||
        '–' || to_char(v_wave.window_end, 'Mon FMDD'),
      p_visibility_scope => 'farm_shared',
      p_importance => 'attention',
      p_object_id => v_wave.source_object_id,
      p_crop_cycle_id => v_wave.source_cycle_id,
      p_payload => jsonb_build_object(
        'deepLink', '/harvest',
        'surface', 'harvest_horizon',
        'cropKey', v_wave.crop_key,
        'cropLabel', v_wave.crop_label,
        'variety', v_wave.variety,
        'windowStart', v_wave.window_start,
        'windowEnd', v_wave.window_end,
        'cropCycleIds', to_jsonb(v_wave.crop_cycle_ids),
        'objectLabels', to_jsonb(v_wave.object_labels),
        'cycleCount', v_wave.cycle_count,
        'timeClaimsPhysicalCondition', false
      ),
      p_provenance => jsonb_build_object(
        'contractVersion', 'harvest_horizon_v1',
        'source', 'crop_cycle_yield_forecast',
        'grouping', 'crop_profile_variety_window'
      )
    );
    if v_event_id is not null then v_inserted := v_inserted + 1; end if;
  end loop;

  return jsonb_build_object(
    'contractVersion', 'harvest_horizon_v1',
    'asOf', v_as_of,
    'farmId', p_farm_id,
    'waves', v_inserted
  );
end;
$function$;

create or replace function atlas.enroll_harvest_watch_v1(
  p_crop_cycle_id uuid,
  p_task_id uuid default null,
  p_due_date_override date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_status text;
  v_due_date date;
begin
  select * into v_cycle from atlas.crop_cycles where id = p_crop_cycle_id;
  if v_cycle.id is null then
    return jsonb_build_object('enrolled', false, 'reason', 'cycle_not_found');
  end if;

  select * into v_object from atlas.growing_objects where id = v_cycle.object_id;
  select status into v_status
  from atlas.crop_harvest_availability
  where crop_cycle_id = v_cycle.id;

  if v_cycle.lifecycle_status <> 'active'
     or v_cycle.expected_harvest_watch_start is null
     or lower(coalesce(v_cycle.cycle_state, '')) in ('failed', 'cleared', 'finished', 'finished_harvest')
     or coalesce(v_object.stable_key, '') like 'grow_room_%'
     or v_status = 'finished'
  then
    update atlas.rhythm_state
    set state = 'paused',
        state_reason = jsonb_build_object(
          'source', 'harvest_horizon_stage_exit',
          'cycleState', v_cycle.cycle_state
        ),
        current_task_id = null,
        current_occurrence_id = null,
        updated_at = now()
    where farm_id = v_cycle.farm_id
      and rhythm_key = 'harvest_watch'
      and subject_kind = 'crop_cycle'
      and subject_id = v_cycle.id;

    return jsonb_build_object(
      'enrolled', false,
      'mode', 'harvest_horizon',
      'reason', 'not_harvest_horizon_eligible',
      'cycleState', v_cycle.cycle_state
    );
  end if;

  v_due_date := coalesce(p_due_date_override, v_cycle.expected_harvest_watch_start);

  update atlas.rhythm_state
  set state = 'paused',
      state_reason = jsonb_build_object(
        'source', 'harvest_horizon_replaced_watch_task',
        'dueDate', v_due_date
      ),
      current_task_id = null,
      current_occurrence_id = null,
      metadata = metadata || jsonb_build_object(
        'harvestHorizonMode', true,
        'watchTaskSuppressed', true
      ),
      updated_at = now()
  where farm_id = v_cycle.farm_id
    and rhythm_key = 'harvest_watch'
    and subject_kind = 'crop_cycle'
    and subject_id = v_cycle.id;

  insert into atlas.crop_harvest_availability(
    crop_cycle_id,
    farm_id,
    status,
    observed_date,
    current_watch_task_id,
    current_watch_occurrence_id,
    metadata
  ) values (
    v_cycle.id,
    v_cycle.farm_id,
    'watching',
    null,
    null,
    null,
    jsonb_build_object(
      'harvestHorizonMode', true,
      'expectedWindowStart', v_cycle.expected_harvest_watch_start,
      'expectedWindowEnd', v_cycle.expected_harvest_watch_end,
      'tasklessForecast', true
    )
  )
  on conflict (crop_cycle_id) do update
  set current_watch_task_id = null,
      current_watch_occurrence_id = null,
      metadata = atlas.crop_harvest_availability.metadata || excluded.metadata,
      updated_at = now();

  perform atlas.harvest_horizon_tick_v1(v_cycle.farm_id, (now() at time zone 'America/Chicago')::date);

  return jsonb_build_object(
    'enrolled', true,
    'mode', 'harvest_horizon',
    'taskId', null,
    'occurrenceId', null,
    'dueDate', v_due_date,
    'cropCycleId', v_cycle.id
  );
end;
$function$;

create or replace function atlas.suppress_harvest_watch_task_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
begin
  if lower(coalesce(new.task_type, '')) = 'harvest_watch'
     or lower(coalesce(new.metadata ->> 'task_style', '')) = 'harvest_watch'
  then
    new.status := 'archived';
    new.task_type := 'harvest_horizon_marker';
    new.action_key := 'harvest_horizon';
    new.visibility_scope := 'system_internal';
    new.assigned_membership_id := null;
    new.assigned_user_id := null;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'harvestHorizonMode', true,
      'watchTaskSuppressed', true,
      'suppressedAt', now(),
      'task_style', 'harvest_horizon_marker',
      'structured_result_required', false
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists zzz_tasks_suppress_harvest_watch_v1 on atlas.tasks;
create trigger zzz_tasks_suppress_harvest_watch_v1
before insert or update of task_type, action_key, metadata, status
on atlas.tasks
for each row
execute function atlas.suppress_harvest_watch_task_v1();

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

  if v_event.source_event = 'harvest_horizon_entry'
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
    if v_object_key is not null then
      return '/objects/' || v_object_key;
    end if;
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
  select event.* into v_event
  from atlas.journal_event_index event
  where event.id = p_event_id;

  if v_event.id is null then
    return 'Atlas recorded a meaningful change connected to work visible to this account.';
  end if;

  if v_event.source_event = 'harvest_horizon_entry'
     or v_event.payload ->> 'surface' = 'harvest_horizon'
  then
    return 'This crop wave entered the next 21 days, so it now belongs in Harvest planning rather than the daily Work list.';
  end if;
  if v_event.event_kind = 'rhythm_warning' then
    return 'This rhythm is approaching its next boundary, so Atlas is giving the responsible account time to place the work before it becomes due.';
  end if;
  if v_event.event_kind = 'rhythm_due' then
    return 'Atlas expected this rhythm to renew by now, but no completed work or acceptable observation was recorded.';
  end if;
  if v_event.event_kind = 'rhythm_failure' then
    return 'This rhythm crossed its failure boundary after its last completed work or accepted observation.';
  end if;
  if v_event.event_kind = 'owner_decision' then
    return 'A decision or problem handoff reached the Owner or manager responsible for the next move.';
  end if;
  if v_event.event_kind = 'unlock' then
    return 'A dependency cleared and made a next move available.';
  end if;
  if v_event.event_kind in ('task_result', 'maintenance_result') then
    if v_event.assigned_user_id = p_effective_user_id then
      return 'A result changed work assigned to this account.';
    end if;
    return 'Another player changed work in a farm or project visible to this account.';
  end if;
  if v_event.event_kind = 'production_change' then
    return 'A production state changed in a way Atlas considers meaningful to the selected account.';
  end if;

  return 'Atlas recorded a meaningful change connected to work visible to this account.';
end;
$function$;

-- Retire currently released forecast-only cards without touching real harvest work
-- or readiness tasks that happen to use harvest language.
update atlas.planned_work_occurrences occurrence
set state = 'cancelled',
    metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
      'cancelledBy', 'harvest_horizon_v1',
      'cancelledAt', now(),
      'reason', 'Forecast moved from Work to Harvest'
    ),
    updated_at = now()
from atlas.tasks task
where occurrence.id = task.planned_occurrence_id
  and task.status in ('open', 'blocked')
  and (
    lower(coalesce(task.task_type, '')) = 'harvest_watch'
    or lower(coalesce(task.metadata ->> 'task_style', '')) = 'harvest_watch'
  );

update atlas.tasks
set status = 'archived',
    task_type = 'harvest_horizon_marker',
    action_key = 'harvest_horizon',
    visibility_scope = 'system_internal',
    assigned_membership_id = null,
    assigned_user_id = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'harvestHorizonMode', true,
      'watchTaskSuppressed', true,
      'suppressedAt', now(),
      'task_style', 'harvest_horizon_marker',
      'structured_result_required', false
    ),
    updated_at = now()
where status in ('open', 'blocked')
  and (
    lower(coalesce(task_type, '')) = 'harvest_watch'
    or lower(coalesce(metadata ->> 'task_style', '')) = 'harvest_watch'
  );

update atlas.crop_harvest_availability
set current_watch_task_id = null,
    current_watch_occurrence_id = null,
    metadata = metadata || jsonb_build_object(
      'harvestHorizonMode', true,
      'tasklessForecast', true,
      'migratedAt', now()
    ),
    updated_at = now()
where current_watch_task_id is not null
   or current_watch_occurrence_id is not null
   or status = 'watching';

update atlas.rhythm_state
set state = 'paused',
    state_reason = jsonb_build_object(
      'source', 'harvest_horizon_v1',
      'reason', 'Forecast-only watch work moved to Harvest'
    ),
    current_task_id = null,
    current_occurrence_id = null,
    metadata = metadata || jsonb_build_object(
      'harvestHorizonMode', true,
      'watchTaskSuppressed', true,
      'migratedAt', now()
    ),
    updated_at = now()
where rhythm_key = 'harvest_watch';

-- One farm-local run shortly after midnight updates the grouped Bell entries.
do $block$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'atlas-harvest-horizon-daily-v1';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'atlas-harvest-horizon-daily-v1',
    '31 5 * * *',
    $command$select atlas.harvest_horizon_tick_v1();$command$
  );
end;
$block$;

select atlas.harvest_horizon_tick_v1();
