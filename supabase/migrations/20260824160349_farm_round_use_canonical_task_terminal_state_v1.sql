drop trigger if exists guard_farm_round_parent_derived_completion_v1 on atlas.tasks;

create or replace function atlas.reconcile_farm_round_completion_v1(p_parent_occurrence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_parent_task atlas.tasks%rowtype;
  v_open integer := 0;
  v_transition jsonb := null;
begin
  select t.* into v_parent_task
  from atlas.planned_work_occurrences o
  join atlas.tasks t on t.id=o.released_task_id
  where o.id=p_parent_occurrence_id
    and coalesce(t.metadata->>'farm_round_parent','false') in ('true','yes','1')
  limit 1;

  if v_parent_task.id is null then
    return jsonb_build_object('state','not_farm_round');
  end if;

  select count(*) into v_open
  from atlas.tasks child
  where child.parent_task_id=v_parent_task.id
    and child.status not in ('done','archived');

  if v_open=0 then
    if v_parent_task.status not in ('done','archived') then
      v_transition := atlas.record_task_transition_v1(
        v_parent_task.id,
        'done',
        'farm-round:auto-parent:'||p_parent_occurrence_id::text,
        coalesce(v_parent_task.due_date,timezone('America/Chicago',now())::date),
        'Farm Round completed from canonical member task state.',
        null,
        v_parent_task.action_key,
        v_parent_task.action_key,
        jsonb_build_object(
          'farmRoundParent',true,
          'completionSource','all_member_tasks_terminal',
          'parentOccurrenceId',p_parent_occurrence_id
        ),
        null
      );
    end if;

    update atlas.planned_work_occurrences
    set state='completed',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundCompletionSource','canonical_task_terminal_state','farmRoundCompletedAt',now()),
        updated_at=now()
    where id=p_parent_occurrence_id
      and state not in ('completed','cancelled');

    update atlas.farm_round_occurrences
    set status='completed',parent_task_id=coalesce(parent_task_id,v_parent_task.id),updated_at=now()
    where parent_occurrence_id=p_parent_occurrence_id;

    return jsonb_build_object('state','completed','parentTaskId',v_parent_task.id,'transition',v_transition);
  end if;

  return jsonb_build_object('state','open','parentTaskId',v_parent_task.id,'openMembers',v_open);
end;
$function$;

create or replace function atlas.complete_farm_round_parent_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_parent_occurrence_id uuid;
begin
  if new.parent_task_id is null or old.status is not distinct from new.status then
    return new;
  end if;

  select t.planned_occurrence_id into v_parent_occurrence_id
  from atlas.tasks t
  where t.id=new.parent_task_id
    and t.task_type='stewardship_round'
    and coalesce(t.metadata->>'farm_round_parent','false') in ('true','yes','1');

  if v_parent_occurrence_id is null then
    return new;
  end if;

  if new.planned_occurrence_id is not null then
    update atlas.planned_work_occurrences
    set state=case when new.status in ('done','archived') then 'completed' else 'released' end,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundMemberTaskStatus',new.status,'farmRoundMemberTaskSyncedAt',now()),
        updated_at=now()
    where id=new.planned_occurrence_id
      and state <> 'cancelled';
  end if;

  perform atlas.reconcile_farm_round_completion_v1(v_parent_occurrence_id);
  return new;
end;
$function$;

create or replace function atlas.sync_farm_round_parent_task_projection_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if old.status is not distinct from new.status
     or coalesce(new.metadata->>'farm_round_parent','false') not in ('true','yes','1')
  then
    return new;
  end if;

  if new.planned_occurrence_id is not null then
    update atlas.planned_work_occurrences
    set state=case when new.status in ('done','archived') then 'completed' else 'released' end,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundParentTaskStatus',new.status,'farmRoundParentTaskSyncedAt',now()),
        updated_at=now()
    where id=new.planned_occurrence_id
      and state <> 'cancelled';
  end if;

  update atlas.farm_round_occurrences
  set status=case when new.status in ('done','archived') then 'completed' else 'open' end,
      parent_task_id=new.id,
      updated_at=now()
  where parent_occurrence_id=new.planned_occurrence_id;

  return new;
end;
$function$;

drop trigger if exists sync_farm_round_parent_task_projection_v1 on atlas.tasks;
create trigger sync_farm_round_parent_task_projection_v1
after update of status on atlas.tasks
for each row
when (old.status is distinct from new.status)
execute function atlas.sync_farm_round_parent_task_projection_v1();