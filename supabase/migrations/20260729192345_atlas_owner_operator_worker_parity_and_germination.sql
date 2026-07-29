create or replace function atlas.owner_operator_home_task_cards_v1(
  p_effective_membership_id uuid,
  p_due_through date default null,
  p_done_date date default null
)
returns setof atlas.v_task_cards
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context jsonb;
  v_farm_id uuid;
  v_membership_id uuid;
  v_role text;
  v_task_ids uuid[] := '{}'::uuid[];
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id := (v_context ->> 'farmId')::uuid;
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  v_role := v_context #>> '{effective,role}';

  select coalesce(array_agg(task.id), '{}'::uuid[])
  into v_task_ids
  from atlas.tasks task
  where task.farm_id = v_farm_id
    and task.status <> 'archived'
    and (
      task.visibility_scope = 'farm_shared'
      or (
        task.visibility_scope = 'assigned_worker'
        and task.assigned_membership_id = v_membership_id
      )
      or (
        v_role = 'manager'
        and task.visibility_scope = 'management'
      )
      or (
        v_role = 'owner'
        and task.visibility_scope in ('owner', 'management')
        and (
          task.assigned_membership_id is null
          or task.assigned_membership_id = v_membership_id
        )
      )
    )
    and (
      (
        task.status in ('open', 'blocked')
        and (p_due_through is null or task.due_date is null or task.due_date <= p_due_through)
      )
      or (
        task.status = 'done'
        and p_done_date is not null
        and task.due_date = p_done_date
      )
    );

  if cardinality(v_task_ids) = 0 then
    return;
  end if;

  return query
  select card.*
  from atlas.v_task_cards card
  where card.task_id = any(v_task_ids)
  order by card.due_date nulls last, card.priority, card.created_at;
end;
$function$;

create or replace function atlas.owner_operator_germination_check_source_v1(
  p_effective_membership_id uuid,
  p_task_id uuid default null,
  p_task_title text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_farm_id uuid;
  v_membership_id uuid;
  v_role text;
  v_visible boolean := false;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id := (v_context ->> 'farmId')::uuid;
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  v_role := v_context #>> '{effective,role}';

  select task.*
  into v_task
  from atlas.tasks task
  where task.farm_id = v_farm_id
    and task.status in ('open', 'blocked')
    and (
      (p_task_id is not null and task.id = p_task_id)
      or (
        p_task_id is null
        and nullif(btrim(p_task_title), '') is not null
        and lower(task.title) = lower(btrim(p_task_title))
      )
    )
  order by task.due_date nulls last, task.created_at
  limit 1;

  if v_task.id is null then
    raise exception 'Germination check task was not found.' using errcode = 'P0002';
  end if;

  v_visible := case
    when v_role = 'owner' then v_task.visibility_scope in ('owner', 'management', 'assigned_worker', 'farm_shared')
    when v_role = 'manager' then
      v_task.visibility_scope in ('management', 'farm_shared')
      or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_membership_id)
    else
      v_task.visibility_scope = 'farm_shared'
      or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_membership_id)
  end;

  if not v_visible then
    raise exception 'The germination task is not visible in the selected worker context.' using errcode = '42501';
  end if;

  return atlas.germination_check_source_v1(v_farm_id, v_task.id, null);
end;
$function$;

create or replace function atlas.owner_operator_record_germination_check_v1(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_action text,
  p_spacing_outcome text default null,
  p_target_spacing_inches numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_farm_id uuid;
  v_membership_id uuid;
  v_role text;
  v_actor_membership_id uuid;
  v_visible boolean := false;
  v_result jsonb;
  v_operator_payload jsonb;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id := (v_context ->> 'farmId')::uuid;
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  v_role := v_context #>> '{effective,role}';
  v_actor_membership_id := (v_context #>> '{actor,membershipId}')::uuid;

  select task.*
  into v_task
  from atlas.tasks task
  where task.id = p_task_id
    and task.farm_id = v_farm_id
  for update;

  if v_task.id is null then
    raise exception 'Germination check task was not found.' using errcode = 'P0002';
  end if;

  v_visible := case
    when v_role = 'owner' then v_task.visibility_scope in ('owner', 'management', 'assigned_worker', 'farm_shared')
    when v_role = 'manager' then
      v_task.visibility_scope in ('management', 'farm_shared')
      or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_membership_id)
    else
      v_task.visibility_scope = 'farm_shared'
      or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_membership_id)
  end;

  if not v_visible then
    raise exception 'The germination task is not visible in the selected worker context.' using errcode = '42501';
  end if;

  v_result := atlas.record_germination_check_for_member_v1(
    v_farm_id,
    v_task.id,
    null,
    p_action,
    p_spacing_outcome,
    p_target_spacing_inches
  );

  v_operator_payload := jsonb_build_object(
    'operator_mode', true,
    'actor_user_id', auth.uid(),
    'actor_membership_id', v_actor_membership_id,
    'actor_role', 'owner',
    'effective_membership_id', v_membership_id,
    'effective_role', v_role,
    'effective_worker_key', v_context #>> '{effective,workerKey}',
    'effective_display_name', v_context #>> '{effective,displayName}'
  );

  if not coalesce((v_result ->> 'deduplicated')::boolean, false) then
    with latest_transition as (
      select transition.id
      from atlas.task_transitions transition
      where transition.task_id = v_task.id
        and (
          (p_action = 'not_yet' and transition.transition = 'rescheduled')
          or (p_action = 'germinated' and transition.transition = 'done')
        )
      order by transition.created_at desc
      limit 1
    )
    update atlas.task_transitions transition
    set payload = coalesce(transition.payload, '{}'::jsonb) || v_operator_payload
    where transition.id in (select id from latest_transition);
  end if;

  return v_result || jsonb_build_object(
    'operatorMode', true,
    'effectiveMembershipId', v_membership_id,
    'actorMembershipId', v_actor_membership_id
  );
end;
$function$;

revoke all on function atlas.owner_operator_home_task_cards_v1(uuid, date, date) from public;
revoke all on function atlas.owner_operator_home_task_cards_v1(uuid, date, date) from anon;
grant execute on function atlas.owner_operator_home_task_cards_v1(uuid, date, date) to authenticated;

revoke all on function atlas.owner_operator_germination_check_source_v1(uuid, uuid, text) from public;
revoke all on function atlas.owner_operator_germination_check_source_v1(uuid, uuid, text) from anon;
grant execute on function atlas.owner_operator_germination_check_source_v1(uuid, uuid, text) to authenticated;

revoke all on function atlas.owner_operator_record_germination_check_v1(uuid, uuid, text, text, numeric) from public;
revoke all on function atlas.owner_operator_record_germination_check_v1(uuid, uuid, text, text, numeric) from anon;
grant execute on function atlas.owner_operator_record_germination_check_v1(uuid, uuid, text, text, numeric) to authenticated;
