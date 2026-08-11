-- Active tasks and released planned-work occurrences are two operational lenses
-- over the same scheduled work. Keep their current dates aligned when the date
-- changes through either the canonical transition engine or the employee Sunday
-- guardrail. Historical-release occurrences explicitly marked as provenance are
-- excluded because their date is intentionally not a current schedule claim.

create or replace function atlas.sync_rescheduled_task_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_occurrence_id uuid;
  v_task atlas.tasks%rowtype;
begin
  if new.transition not in ('rescheduled','unfinished') or new.target_date is null then
    return new;
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=new.task_id
    and task.farm_id=new.farm_id;

  if v_task.id is null
     or coalesce(v_task.metadata->>'planned_occurrence_date_role','')='historical_release_provenance' then
    return new;
  end if;

  v_occurrence_id:=coalesce(
    v_task.planned_occurrence_id,
    case
      when nullif(v_task.metadata->>'planned_occurrence_id','') ~* '^[0-9a-f-]{36}$'
      then (v_task.metadata->>'planned_occurrence_id')::uuid
      else null
    end
  );

  if v_occurrence_id is null then
    return new;
  end if;

  update atlas.planned_work_occurrences occurrence
  set planned_due_date=new.target_date,
      not_before_date=case
        when occurrence.not_before_date is null
          or occurrence.not_before_date=occurrence.planned_due_date
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

-- A Sunday guardrail is a real current schedule change. It happens in a BEFORE
-- task trigger, so synchronize the already-linked released occurrence afterward,
-- when the final guarded due date and planned_occurrence_id are both available.
create or replace function atlas.sync_sunday_guardrail_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_occurrence_id uuid;
  v_original_due date;
begin
  if coalesce((new.metadata->>'sunday_guardrail_applied')::boolean,false) is distinct from true
     or new.due_date is null
     or coalesce(new.metadata->>'planned_occurrence_date_role','')='historical_release_provenance' then
    return new;
  end if;

  begin
    v_original_due:=nullif(new.metadata->>'sunday_guardrail_original_due_date','')::date;
  exception when others then
    v_original_due:=null;
  end;

  v_occurrence_id:=coalesce(
    new.planned_occurrence_id,
    case
      when nullif(new.metadata->>'planned_occurrence_id','') ~* '^[0-9a-f-]{36}$'
      then (new.metadata->>'planned_occurrence_id')::uuid
      else null
    end
  );

  if v_occurrence_id is null then
    return new;
  end if;

  update atlas.planned_work_occurrences occurrence
  set planned_due_date=new.due_date,
      not_before_date=case
        when occurrence.not_before_date is null
          or occurrence.not_before_date=occurrence.planned_due_date
          or occurrence.not_before_date=v_original_due
        then new.due_date
        else occurrence.not_before_date
      end,
      metadata=coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
        'sunday_guardrail_current_schedule',jsonb_build_object(
          'task_id',new.id,
          'original_due_date',v_original_due,
          'shifted_to',new.due_date,
          'synced_at',now()
        )
      ),
      updated_at=now()
  where occurrence.id=v_occurrence_id
    and occurrence.farm_id=new.farm_id
    and occurrence.released_task_id=new.id
    and occurrence.state='released'
    and occurrence.planned_due_date is distinct from new.due_date;

  return new;
end;
$function$;

revoke all on function atlas.sync_sunday_guardrail_occurrence_v1() from public,anon,authenticated;
grant execute on function atlas.sync_sunday_guardrail_occurrence_v1() to service_role;

drop trigger if exists sync_sunday_guardrail_occurrence_v1 on atlas.tasks;
create trigger sync_sunday_guardrail_occurrence_v1
after insert or update of due_date,metadata,planned_occurrence_id on atlas.tasks
for each row
when (new.due_date is not null)
execute function atlas.sync_sunday_guardrail_occurrence_v1();

-- Reconcile active historical splits only where canonical evidence is decisive:
-- the task's current due date equals its latest reschedule/unfinished target and
-- the released occurrence still carries an older date. This deliberately does
-- not infer intent from arbitrary metadata or overwrite historical provenance.
with latest_move as (
  select distinct on (transition.task_id)
    transition.task_id,
    transition.target_date,
    transition.previous_due_date,
    transition.id as transition_id,
    transition.created_at
  from atlas.task_transitions transition
  where transition.transition in ('rescheduled','unfinished')
    and transition.target_date is not null
  order by transition.task_id,transition.created_at desc
), candidates as (
  select task.id as task_id,
         task.farm_id,
         task.planned_occurrence_id,
         latest.target_date,
         latest.previous_due_date,
         latest.transition_id,
         latest.created_at
  from atlas.tasks task
  join latest_move latest on latest.task_id=task.id
  join atlas.planned_work_occurrences occurrence on occurrence.id=task.planned_occurrence_id
  where task.status in ('open','blocked')
    and task.due_date=latest.target_date
    and occurrence.state='released'
    and occurrence.released_task_id=task.id
    and occurrence.planned_due_date is distinct from latest.target_date
    and coalesce(task.metadata->>'planned_occurrence_date_role','')<>'historical_release_provenance'
)
update atlas.planned_work_occurrences occurrence
set planned_due_date=candidate.target_date,
    not_before_date=case
      when occurrence.not_before_date is null
        or occurrence.not_before_date=occurrence.planned_due_date
        or occurrence.not_before_date=candidate.previous_due_date
      then candidate.target_date
      else occurrence.not_before_date
    end,
    metadata=coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
      'active_schedule_reconciled_from_transition',jsonb_build_object(
        'task_id',candidate.task_id,
        'transition_id',candidate.transition_id,
        'previous_due_date',candidate.previous_due_date,
        'target_date',candidate.target_date,
        'transition_recorded_at',candidate.created_at,
        'reconciled_at',now()
      )
    ),
    updated_at=now()
from candidates candidate
where occurrence.id=candidate.planned_occurrence_id
  and occurrence.farm_id=candidate.farm_id;

-- Reconcile employee work already shifted by the Sunday guardrail before the
-- post-guardrail occurrence synchronizer existed. The guardrail metadata itself
-- is the evidence; no title/id-specific patch is required.
update atlas.planned_work_occurrences occurrence
set planned_due_date=task.due_date,
    not_before_date=case
      when occurrence.not_before_date is null
        or occurrence.not_before_date=occurrence.planned_due_date
        or occurrence.not_before_date=nullif(task.metadata->>'sunday_guardrail_original_due_date','')::date
      then task.due_date
      else occurrence.not_before_date
    end,
    metadata=coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
      'sunday_guardrail_current_schedule',jsonb_build_object(
        'task_id',task.id,
        'original_due_date',task.metadata->>'sunday_guardrail_original_due_date',
        'shifted_to',task.due_date,
        'synced_at',now(),
        'source','active_occurrence_date_reconciliation_v1'
      )
    ),
    updated_at=now()
from atlas.tasks task
where occurrence.id=task.planned_occurrence_id
  and occurrence.farm_id=task.farm_id
  and occurrence.released_task_id=task.id
  and occurrence.state='released'
  and task.status in ('open','blocked')
  and task.due_date is not null
  and coalesce((task.metadata->>'sunday_guardrail_applied')::boolean,false)=true
  and coalesce(task.metadata->>'planned_occurrence_date_role','')<>'historical_release_provenance'
  and occurrence.planned_due_date is distinct from task.due_date;
