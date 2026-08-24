alter function atlas.roll_expired_worker_tasks_v1(uuid,uuid,date) rename to roll_expired_worker_tasks_v1_legacy;

create or replace function atlas.roll_expired_worker_tasks_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_target_date date default null::date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_timezone text := 'America/Chicago';
  v_today date;
  v_target date;
  v_task record;
  v_dest_occurrence atlas.planned_work_occurrences%rowtype;
  v_superseded integer := 0;
  v_result jsonb;
begin
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
    into v_timezone
  from atlas.farms f where f.id=p_farm_id;

  v_today := (now() at time zone v_timezone)::date;
  v_target := coalesce(p_target_date,v_today);
  if v_target < v_today then v_target := v_today; end if;
  v_target := atlas.worker_day_on_or_after_v1(p_farm_id,p_membership_id,v_target);

  if v_target is null then
    return jsonb_build_object('moved',0,'superseded',0,'expiredWeeklyHarvestRounds',0,'reason','no_available_worker_day');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':'||p_membership_id::text||':daily-recurrence-handoff',0));

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
      and t.task_series_key is not null
      and coalesce(t.metadata->>'repeat_rule','') like 'daily%'
    order by t.due_date,t.created_at,t.id
    for update
  loop
    select o.* into v_dest_occurrence
    from atlas.planned_work_occurrences o
    where o.farm_id=p_farm_id
      and o.planned_due_date=v_target
      and o.state<>'cancelled'
      and o.id<>coalesce(v_task.planned_occurrence_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and o.occurrence_key=('recurring:'||v_task.task_series_key||':'||v_target::text)
    order by o.created_at,o.id
    limit 1;

    if v_dest_occurrence.id is null then
      continue;
    end if;

    perform atlas.record_task_transition_v1_internal(
      v_task.id,
      'changed_plan',
      left('daily-recurrence-handoff:'||v_task.id::text||':'||v_target::text,160),
      null,
      null,
      'Expired daily occurrence handed forward to the destination recurrence.',
      v_task.action_key,
      'daily_recurrence_handoff',
      jsonb_build_object(
        'calendarRollover',false,
        'closedFromDate',v_task.due_date,
        'targetDate',v_target,
        'disposition','superseded_by_destination_daily_occurrence',
        'destinationOccurrenceId',v_dest_occurrence.id
      ),
      null
    );

    if v_task.planned_occurrence_id is not null then
      update atlas.planned_work_occurrences
      set state='cancelled',
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'dailyRecurrenceHandoff',true,
            'dailyRecurrenceHandoffDisposition','superseded_by_destination_daily_occurrence',
            'dailyRecurrenceHandoffTargetDate',v_target,
            'dailyRecurrenceHandoffDestinationOccurrenceId',v_dest_occurrence.id,
            'dailyRecurrenceHandoffAt',now()
          ),
          updated_at=now()
      where id=v_task.planned_occurrence_id
        and state not in ('completed','cancelled');
    end if;

    update atlas.planned_work_occurrences
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'carriedUnfinishedDailyRecurrence',true,
          'carriedUnfinishedFromTaskId',v_task.id,
          'carriedUnfinishedFromOccurrenceId',v_task.planned_occurrence_id,
          'carriedUnfinishedFromDate',v_task.due_date,
          'carriedUnfinishedAt',now()
        ),
        updated_at=now()
    where id=v_dest_occurrence.id;

    if v_dest_occurrence.released_task_id is not null then
      update atlas.tasks
      set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'carried_unfinished_daily_recurrence',true,
            'carried_unfinished_from_task_id',v_task.id,
            'carried_unfinished_from_occurrence_id',v_task.planned_occurrence_id,
            'carried_unfinished_from_date',v_task.due_date,
            'carried_unfinished_at',now()
          ),
          updated_at=now()
      where id=v_dest_occurrence.released_task_id;
    end if;

    v_superseded := v_superseded + 1;
  end loop;

  v_result := atlas.roll_expired_worker_tasks_v1_legacy(p_farm_id,p_membership_id,v_target);
  return coalesce(v_result,'{}'::jsonb) || jsonb_build_object('dailyRecurringIdentityHandoffs',v_superseded);
end;
$$;

revoke all on function atlas.roll_expired_worker_tasks_v1(uuid,uuid,date) from public, anon, authenticated, service_role;
grant execute on function atlas.roll_expired_worker_tasks_v1(uuid,uuid,date) to postgres;
