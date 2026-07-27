create or replace function atlas.grow_room_resolve_round_request_v1(
  p_farm_id uuid,
  p_visit_task_id uuid,
  p_request_task_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_target_date date default null,
  p_note text default null,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_assignment atlas.grow_room_round_requests%rowtype;
  v_visit atlas.tasks%rowtype;
  v_role text;
  v_current_membership_id uuid;
  v_result jsonb;
  v_actor_payload jsonb;
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;

  if p_transition not in ('done', 'blocked', 'rescheduled', 'unfinished') then
    raise exception 'Unsupported Grow Room request result.' using errcode = '22023';
  end if;

  if p_transition in ('rescheduled', 'unfinished') and p_target_date is null then
    raise exception 'A new date is required.' using errcode = '22023';
  end if;

  select rr.* into v_assignment
  from atlas.grow_room_round_requests rr
  where rr.farm_id = p_farm_id
    and rr.visit_task_id = p_visit_task_id
    and rr.request_task_id = p_request_task_id
  for update;

  if v_assignment.id is null then
    raise exception 'Grow Room request not found.' using errcode = 'P0002';
  end if;

  if v_assignment.resolved_at is not null then
    return jsonb_build_object(
      'ok', true,
      'deduplicated', true,
      'requestTaskId', p_request_task_id,
      'resolutionKey', v_assignment.resolution_key
    );
  end if;

  select t.* into v_visit
  from atlas.tasks t
  where t.id = p_visit_task_id
    and t.farm_id = p_farm_id
    and t.task_type = 'grow_room_care'
  for update;

  if v_visit.id is null then
    raise exception 'Grow Room Care task not found.' using errcode = 'P0002';
  end if;

  v_role := atlas.current_farm_role(p_farm_id);
  v_current_membership_id := atlas.current_membership_id(p_farm_id);

  if v_role <> 'owner' and (
    v_role not in ('farm_hand', 'manager')
    or v_current_membership_id is null
    or v_visit.visibility_scope <> 'assigned_worker'
    or v_visit.assigned_membership_id <> v_current_membership_id
  ) then
    raise exception 'This Grow Room round is not assigned to the signed-in farm member.' using errcode = '42501';
  end if;

  v_actor_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'source_surface', 'grow_room_round',
    'delegated_from_visit_task_id', p_visit_task_id,
    'actor_user_id', auth.uid(),
    'actor_membership_id', v_current_membership_id,
    'actor_role', v_role
  );

  if v_role = 'owner' then
    v_result := atlas.owner_record_task_transition_v1(
      p_request_task_id,
      p_transition,
      p_idempotency_key,
      p_target_date,
      p_note,
      p_reason,
      null,
      null,
      v_actor_payload,
      null
    );
  else
    v_result := atlas.record_task_transition_v1(
      p_request_task_id,
      p_transition,
      p_idempotency_key,
      p_target_date,
      p_note,
      p_reason,
      null,
      null,
      v_actor_payload,
      null
    );
  end if;

  update atlas.grow_room_round_requests
  set resolved_at = now(),
      resolution_key = p_transition,
      resolution_payload = coalesce(p_payload, '{}'::jsonb),
      metadata = metadata || jsonb_build_object('transition_result', v_result)
  where id = v_assignment.id;

  return jsonb_build_object(
    'ok', true,
    'deduplicated', false,
    'requestTaskId', p_request_task_id,
    'resolutionKey', p_transition,
    'transition', v_result
  );
end;
$$;

grant execute on function atlas.grow_room_resolve_round_request_v1(uuid, uuid, uuid, text, text, date, text, text, jsonb) to authenticated;
