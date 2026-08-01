begin;

do $migration$
declare
  v_definition text;
  v_old_fragment text := $old$
      and (
        task.assigned_membership_id = v_membership_id
        or task.assigned_user_id = v_user_id
      )
      and atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id)
    order by event.task_id, event.occurred_at desc, event.id desc
$old$;
  v_new_fragment text := $new$
      and (
        task.assigned_membership_id = v_membership_id
        or task.assigned_user_id = v_user_id
      )
      and event.visibility_scope = 'assigned_worker'
    order by event.task_id, event.occurred_at desc, event.id desc
$new$;
  v_occurrences integer;
begin
  if to_regprocedure('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)') is null then
    raise exception 'Expected role-aware atlas.bell_history_v2 before correcting employee movement visibility';
  end if;

  select pg_get_functiondef('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)'::regprocedure)
  into v_definition;

  if v_definition not like '%current_assigned_task_movement_per_task%'
     or v_definition not like '%where not v_is_management%'
     or v_definition not like '%task.due_date <= v_farm_today%' then
    raise exception 'atlas.bell_history_v2 no longer matches the reviewed employee follow-through contract';
  end if;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old_fragment, ''))
  ) / nullif(length(v_old_fragment), 0);

  if v_occurrences <> 1 then
    raise exception 'Expected exactly one employee movement visibility fragment, found %', v_occurrences;
  end if;

  execute replace(v_definition, v_old_fragment, v_new_fragment);
end;
$migration$;

comment on function atlas.bell_history_v2(uuid, uuid, integer, timestamptz) is
  'Role-aware Bell. Owner and manager accounts retain management action queues. Employee accounts receive only assigned-worker movement events for their assigned open tasks once those tasks reach the current farm-local due date.';

do $postcondition$
declare
  v_definition text;
  v_helper_call text := 'atlas.bell_can_read_event_as_v1(event.id, p_farm_id, p_effective_membership_id)';
  v_helper_occurrences integer;
begin
  select pg_get_functiondef('atlas.bell_history_v2(uuid,uuid,integer,timestamp with time zone)'::regprocedure)
  into v_definition;

  v_helper_occurrences := (
    length(v_definition) - length(replace(v_definition, v_helper_call, ''))
  ) / nullif(length(v_helper_call), 0);

  if v_definition not like '%where not v_is_management%'
     or v_definition not like '%event.visibility_scope = ''assigned_worker''%'
     or v_definition not like '%task.assigned_membership_id = v_membership_id%'
     or v_definition not like '%task.assigned_user_id = v_user_id%'
     or v_definition not like '%current_assigned_task_movement_per_task%'
     or v_helper_occurrences <> 1 then
    raise exception 'Employee assigned-movement visibility postcondition failed';
  end if;
end;
$postcondition$;

commit;
