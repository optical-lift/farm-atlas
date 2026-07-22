-- Managers and Farm Hands use one assigned-work transition boundary.
-- The task must still be assigned to the signed-in membership, so this does
-- not grant manager access to another worker's or the owner's task state.

create or replace function atlas.worker_record_task_transition_v1(
  p_task_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_note text default null,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb,
  p_target_date date default null,
  p_lane_key text default null,
  p_work_key text default null,
  p_existing_field_log_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_farm_id uuid;
  v_visibility_scope text;
  v_assigned_membership_id uuid;
  v_current_membership_id uuid;
  v_role text;
  v_payload jsonb;
begin
  select
    t.farm_id,
    t.visibility_scope,
    t.assigned_membership_id
  into
    v_farm_id,
    v_visibility_scope,
    v_assigned_membership_id
  from atlas.tasks t
  where t.id = p_task_id;

  if v_farm_id is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;

  v_role := atlas.current_farm_role(v_farm_id);
  v_current_membership_id := atlas.current_membership_id(v_farm_id);

  if v_role not in ('farm_hand', 'manager')
    or v_current_membership_id is null
    or v_visibility_scope <> 'assigned_worker'
    or v_assigned_membership_id <> v_current_membership_id
  then
    raise exception 'This task is not assigned to the signed-in farm member.' using errcode = '42501';
  end if;

  if p_transition not in (
    'done', 'partial', 'blocked', 'not_relevant', 'changed_plan',
    'rescheduled', 'unfinished', 'checklist_done', 'checklist_open', 'note'
  ) then
    raise exception 'Unsupported assigned-worker transition.' using errcode = '22023';
  end if;

  if p_transition in ('rescheduled', 'unfinished') and p_target_date is null then
    raise exception 'A target date is required for this transition.' using errcode = '22023';
  end if;

  v_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'actor_user_id', auth.uid(),
    'actor_membership_id', v_current_membership_id,
    'actor_role', v_role
  );

  return atlas.record_task_transition_v1(
    p_task_id,
    p_transition,
    p_idempotency_key,
    p_target_date,
    p_note,
    p_reason,
    p_lane_key,
    p_work_key,
    v_payload,
    p_existing_field_log_id
  );
end;
$function$;

comment on function atlas.worker_record_task_transition_v1(uuid, text, text, text, text, jsonb, date, text, text, uuid) is
  'Records task outcomes for Farm Hands and Managers only when the task is assigned to the signed-in membership.';
