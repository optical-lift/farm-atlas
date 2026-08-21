-- Weekly Harvest is a scheduled Thursday observation/harvest round, not unfinished
-- work that should be carried to the next worker day. Expired rounds close as a
-- changed plan (archived, no work/result logged) while the independent weekly
-- recurrence remains intact.

create or replace function atlas.roll_expired_worker_tasks_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_target_date date default null::date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_timezone text := 'America/Chicago';
  v_today date;
  v_target date;
  v_task record;
  v_destination date;
  v_existing_placement date;
  v_result jsonb;
  v_moved integer := 0;
  v_superseded integer := 0;
  v_expired_weekly_harvest integer := 0;
begin
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone
  from atlas.farms f where f.id=p_farm_id;
  v_today := (now() at time zone v_timezone)::date;
  v_target := coalesce(p_target_date,v_today);
  if v_target < v_today then v_target := v_today; end if;
  v_target := atlas.worker_day_on_or_after_v1(p_farm_id,p_membership_id,v_target);
  if v_target is null then
    return jsonb_build_object(
      'moved',0,
      'superseded',0,
      'expiredWeeklyHarvestRounds',0,
      'reason','no_available_worker_day'
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':'||p_membership_id::text||':calendar-rollover',0));

  for v_task in
    select t.*
    from atlas.tasks t
    where t.farm_id=p_farm_id
      and t.assigned_membership_id=p_membership_id
      and t.task_scope='farm_operation'
      and t.status='open'
      and t.due_date is not null
      and t.due_date<v_target
      and t.parent_task_id is null
      and nullif(t.metadata->>'parent_task_id','') is null
      and lower(coalesce(t.metadata->>'is_child_task','false'))<>'true'
      and coalesce(t.visibility_scope,'')<>'system_internal'
    order by t.due_date,t.created_at,t.id
    for update
  loop
    -- A weekly Harvest round is a dated snapshot. Once its Thursday has passed,
    -- archive that occurrence without implying work was performed and without
    -- moving it onto Friday. Its recurrence is independently scheduled.
    if coalesce(v_task.metadata->>'task_style','')='weekly_harvest_round'
       and lower(coalesce(v_task.metadata->>'completion_independent_schedule','false')) in ('true','yes','1')
    then
      perform atlas.record_task_transition_v1_internal(
        v_task.id,
        'changed_plan',
        left('calendar-rollover-expired-weekly-harvest:'||v_task.id::text||':'||v_task.due_date::text,160),
        null,
        null,
        'Weekly Harvest round expired on its scheduled day; it does not carry forward.',
        v_task.action_key,
        'calendar_rollover',
        jsonb_build_object(
          'calendarRollover',false,
          'scheduledDate',v_task.due_date,
          'targetDate',v_target,
          'disposition','expired_weekly_harvest_round',
          'taskStyle','weekly_harvest_round'
        ),
        null
      );
      v_expired_weekly_harvest := v_expired_weekly_harvest + 1;
      continue;
    end if;

    if exists(
      select 1 from atlas.presented_work_selection_rows_unfiltered_v1(p_farm_id,p_membership_id,v_target) r
      where r.task_id=v_task.id and r.presentation_reason='superseded_rhythm_serving'
    ) then
      perform atlas.record_task_transition_v1_internal(
        v_task.id,'changed_plan',
        left('calendar-rollover-superseded:'||v_task.id::text||':'||v_target::text,160),
        null,null,null,
        v_task.action_key,'calendar_rollover',
        jsonb_build_object('calendarRollover',true,'closedFromDate',v_task.due_date,'targetDate',v_target,'disposition','superseded'),null
      );
      v_superseded := v_superseded + 1;
      continue;
    end if;

    select p.service_date into v_existing_placement
    from atlas.worker_day_task_placements p
    where p.task_id=v_task.id and p.state='placed' and p.service_date>=v_target
    limit 1;
    v_destination := coalesce(v_existing_placement,v_target);

    v_result := atlas.record_task_transition_v1_internal(
      v_task.id,'rescheduled',
      left('calendar-rollover:'||v_task.id::text||':'||v_destination::text,160),
      v_destination,
      null,
      null,
      v_task.action_key,'calendar_rollover',
      jsonb_build_object('calendarRollover',true,'closedFromDate',v_task.due_date,'targetDate',v_destination),null
    );

    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'calendar_rollover',true,
      'calendar_rollover_from',v_task.due_date,
      'calendar_rollover_to',v_destination,
      'calendar_rollover_at',now()
    ),updated_at=now()
    where id=v_task.id;

    update atlas.worker_day_task_placements p
    set service_date=v_destination,
        planned_start_at=null,
        updated_at=now()
    where p.task_id=v_task.id and p.state='placed' and p.service_date<v_destination;

    if v_task.planned_occurrence_id is not null then
      update atlas.planned_work_occurrences o
      set planned_due_date=v_destination,
          not_before_date=least(coalesce(o.not_before_date,v_destination),v_destination),
          task_payload=jsonb_set(coalesce(o.task_payload,'{}'::jsonb),'{due_date}',to_jsonb(v_destination),true),
          metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object(
            'calendarRollover',true,
            'calendarRolloverFrom',v_task.due_date,
            'calendarRolloverTo',v_destination,
            'calendarRolloverAt',now()
          ),updated_at=now()
      where o.id=v_task.planned_occurrence_id and o.state not in ('completed','cancelled');
    end if;

    v_moved := v_moved + 1;
  end loop;

  return jsonb_build_object(
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'targetDate',v_target,
    'moved',v_moved,
    'superseded',v_superseded,
    'expiredWeeklyHarvestRounds',v_expired_weekly_harvest
  );
end;
$function$;

-- Repair the already-rolled Aug. 20 weekly Harvest occurrence by stable series/date
-- identity, not by generated task UUID. Restore its historical scheduled date before
-- archiving it so Friday is not recorded as its Harvest day.
do $repair$
declare
  r record;
  v_execution_date date;
begin
  for r in
    select t.id,t.due_date,t.planned_occurrence_id,t.metadata,t.action_key
    from atlas.tasks t
    where t.task_series_key='anna_harvest_thursday_weekly'
      and coalesce(t.metadata->>'task_style','')='weekly_harvest_round'
      and t.status='open'
      and nullif(t.metadata->>'execution_date','')='2026-08-20'
    for update
  loop
    v_execution_date := (r.metadata->>'execution_date')::date;

    if r.due_date is distinct from v_execution_date then
      update atlas.tasks t
      set due_date=v_execution_date,
          metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
            'calendar_rollover_corrected',true,
            'calendar_rollover_corrected_at',now(),
            'calendar_rollover_corrected_from',r.due_date,
            'calendar_rollover_corrected_to',v_execution_date,
            'calendar_rollover_correction_reason','weekly_harvest_round_does_not_carry'
          ),
          updated_at=now()
      where t.id=r.id;
    end if;

    perform atlas.record_task_transition_v1_internal(
      r.id,
      'changed_plan',
      left('weekly-harvest-no-carry:'||r.id::text||':'||v_execution_date::text,160),
      null,
      null,
      'Weekly Harvest round expired on its scheduled Thursday; no Harvest result was recorded.',
      r.action_key,
      'weekly_harvest_expiration',
      jsonb_build_object(
        'scheduledDate',v_execution_date,
        'disposition','expired_weekly_harvest_round',
        'correctsCalendarRollover',true
      ),
      null
    );
  end loop;
end;
$repair$;