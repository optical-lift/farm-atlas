do $$
begin
  if to_regprocedure('atlas.record_task_transition_v1_internal_legacy(uuid,text,text,date,text,text,text,text,jsonb,uuid)') is null then
    alter function atlas.record_task_transition_v1_internal(uuid,text,text,date,text,text,text,text,jsonb,uuid)
      rename to record_task_transition_v1_internal_legacy;
  end if;
end;
$$;

create or replace function atlas.record_task_transition_v1_internal(
  p_task_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_target_date date default null,
  p_note text default null,
  p_reason text default null,
  p_lane_key text default null,
  p_work_key text default null,
  p_payload jsonb default '{}'::jsonb,
  p_existing_field_log_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_existing atlas.task_transitions%rowtype;
  v_children_closed integer := 0;
begin
  if p_task_id is null then
    raise exception 'Task id is required.' using errcode = '22023';
  end if;

  select * into v_task
  from atlas.tasks t
  where t.id = p_task_id
  for update;

  if v_task.id is null then
    raise exception 'Task was not found.' using errcode = 'P0002';
  end if;

  if p_transition in ('done', 'checklist_done') and v_task.status = 'done' then
    select * into v_existing
    from atlas.task_transitions tt
    where tt.task_id = v_task.id
      and tt.next_status = 'done'
    order by tt.created_at desc, tt.id desc
    limit 1;

    if coalesce(v_existing.payload ->> 'children_closed', '') ~ '^\d+$' then
      v_children_closed := (v_existing.payload ->> 'children_closed')::integer;
    end if;

    return jsonb_build_object(
      'transitionId', v_existing.id,
      'taskId', v_task.id,
      'status', 'done',
      'fieldLogId', v_existing.field_log_id,
      'taskOutcomeEventId', v_existing.task_outcome_event_id,
      'childTaskIds', coalesce(v_existing.payload -> 'child_task_ids', '[]'::jsonb),
      'childrenClosed', v_children_closed,
      'nextTaskId', v_existing.payload ->> 'next_task_id',
      'deduplicated', true,
      'terminalStateNoop', true
    );
  end if;

  return atlas.record_task_transition_v1_internal_legacy(
    p_task_id,
    p_transition,
    p_idempotency_key,
    p_target_date,
    p_note,
    p_reason,
    p_lane_key,
    p_work_key,
    coalesce(p_payload, '{}'::jsonb),
    p_existing_field_log_id
  );
end;
$$;

revoke all on function atlas.record_task_transition_v1_internal(uuid,text,text,date,text,text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function atlas.record_task_transition_v1_internal(uuid,text,text,date,text,text,text,text,jsonb,uuid) to service_role;
revoke all on function atlas.record_task_transition_v1_internal_legacy(uuid,text,text,date,text,text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function atlas.record_task_transition_v1_internal_legacy(uuid,text,text,date,text,text,text,text,jsonb,uuid) to service_role;
