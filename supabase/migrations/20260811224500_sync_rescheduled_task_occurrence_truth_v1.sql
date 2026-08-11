-- A released task and its planned-work occurrence are two views of the same
-- current operational plan. When the canonical task transition engine moves a
-- task to another date, keep the linked released occurrence on that date too.
-- Historical truth remains in task_transitions.previous_due_date and release
-- events; this updates only the current operational occurrence.

create or replace function atlas.sync_rescheduled_task_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_occurrence_id uuid;
  v_occurrence_text text;
begin
  if new.transition not in ('rescheduled','unfinished') or new.target_date is null then
    return new;
  end if;

  select nullif(task.metadata->>'planned_occurrence_id','')
    into v_occurrence_text
  from atlas.tasks task
  where task.id=new.task_id
    and task.farm_id=new.farm_id;

  if v_occurrence_text is null then
    return new;
  end if;

  begin
    v_occurrence_id:=v_occurrence_text::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  update atlas.planned_work_occurrences occurrence
  set planned_due_date=new.target_date,
      not_before_date=case
        when occurrence.not_before_date is null
          or occurrence.not_before_date=new.previous_due_date
        then new.target_date
        else occurrence.not_before_date
      end,
      metadata=coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
        'last_operational_reschedule',jsonb_build_object(
          'task_id',new.task_id,
          'transition_id',new.id,
          'previous_due_date',new.previous_due_date,
          'target_date',new.target_date,
          'recorded_at',new.created_at
        )
      ),
      updated_at=now()
  where occurrence.id=v_occurrence_id
    and occurrence.farm_id=new.farm_id
    and occurrence.released_task_id=new.task_id
    and occurrence.state='released';

  return new;
end;
$function$;

revoke all on function atlas.sync_rescheduled_task_occurrence_v1() from public,anon,authenticated;
grant execute on function atlas.sync_rescheduled_task_occurrence_v1() to service_role;

drop trigger if exists sync_rescheduled_task_occurrence_v1 on atlas.task_transitions;
create trigger sync_rescheduled_task_occurrence_v1
after insert on atlas.task_transitions
for each row
when (new.transition in ('rescheduled','unfinished') and new.target_date is not null)
execute function atlas.sync_rescheduled_task_occurrence_v1();

-- Reconcile the one currently-known split-brain released occurrence using the
-- same canonical transition engine. Stable task identity is used instead of a
-- generated database id, and the operation is idempotent.
do $$
declare
  v_task atlas.tasks%rowtype;
  v_target date;
  v_reason text;
begin
  select * into v_task
  from atlas.tasks task
  where task.metadata->>'task_key'='anna_20260716_lilac_haven_front_iris_clump_2'
    and task.status in ('open','blocked')
  order by task.created_at desc
  limit 1;

  if v_task.id is null then
    return;
  end if;

  begin
    v_target:=nullif(v_task.metadata->>'owner_rescheduled_to','')::date;
  exception when others then
    v_target:=null;
  end;

  if v_target is null or v_task.due_date=v_target then
    return;
  end if;

  v_reason:=coalesce(
    nullif(v_task.metadata->>'owner_rescheduled_reason',''),
    'Reconcile Owner reschedule with canonical task and occurrence truth'
  );

  perform atlas.record_task_transition_v1_internal(
    v_task.id,
    'rescheduled',
    'reconcile:owner_rescheduled_to:anna_20260716_lilac_haven_front_iris_clump_2:'||v_target::text,
    v_target,
    null,
    v_reason,
    'operational_reconciliation',
    'owner_reschedule_truth',
    jsonb_build_object(
      'source','atlas_rescheduled_occurrence_truth_v1',
      'ownerRescheduledTo',v_target,
      'reconcilesPlannedOccurrence',true
    ),
    null
  );
end
$$;
