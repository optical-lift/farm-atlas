-- Establish one universal Atlas home whose records are scoped by the signed-in
-- farm membership. Normalize explicit Marshall and Owner tasks so the shared
-- portal can use canonical assignment state rather than route-specific filters.

do $migration$
declare
  v_farm_id uuid;
  v_marshall_membership_id uuid;
  v_owner_membership_id uuid;
begin
  select f.id into v_farm_id
  from atlas.farms f
  where f.stable_key = 'elm_farm';

  if v_farm_id is null then
    raise exception 'Elm Farm was not found.';
  end if;

  select fm.id into v_marshall_membership_id
  from atlas.farm_memberships fm
  where fm.farm_id = v_farm_id
    and fm.active = true
    and fm.worker_key = 'marshall'
  order by fm.created_at
  limit 1;

  select fm.id into v_owner_membership_id
  from atlas.farm_memberships fm
  where fm.farm_id = v_farm_id
    and fm.active = true
    and fm.role = 'owner'
  order by fm.created_at
  limit 1;

  if v_marshall_membership_id is null then
    raise exception 'Marshall membership was not found.';
  end if;

  if v_owner_membership_id is null then
    raise exception 'Owner membership was not found.';
  end if;

  update atlas.tasks t
  set assigned_membership_id = v_marshall_membership_id,
      visibility_scope = 'assigned_worker',
      metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'assignee_key', 'marshall',
        'assigned_to', 'marshall',
        'assignment_normalized_at', now(),
        'assignment_normalized_source', 'universal_atlas_home_phase_1',
        'assignment_previous_visibility_scope', t.visibility_scope
      ),
      updated_at = now()
  where t.farm_id = v_farm_id
    and t.status <> 'archived'
    and (
      lower(coalesce(t.metadata ->> 'assignee_key', '')) = 'marshall'
      or lower(coalesce(t.metadata ->> 'assigned_to', '')) = 'marshall'
      or coalesce(t.metadata ->> 'marshall_task', '') in ('true', 'yes', '1')
    );

  update atlas.tasks t
  set assigned_membership_id = v_owner_membership_id,
      visibility_scope = 'owner',
      metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'assignee_key', 'owner',
        'assigned_to', 'owner',
        'assignment_normalized_at', now(),
        'assignment_normalized_source', 'universal_atlas_home_phase_1',
        'assignment_previous_visibility_scope', t.visibility_scope
      ),
      updated_at = now()
  where t.farm_id = v_farm_id
    and t.status <> 'archived'
    and (
      lower(coalesce(t.metadata ->> 'assignee_key', '')) = 'owner'
      or lower(coalesce(t.metadata ->> 'assigned_to', '')) = 'owner'
      or coalesce(t.metadata ->> 'owner_task', '') in ('true', 'yes', '1')
    );
end;
$migration$;

create or replace function atlas.home_task_cards_v1(
  p_farm_id uuid,
  p_worker_key text default null,
  p_due_through date default null,
  p_done_date date default null
)
returns setof atlas.v_task_cards
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_role text;
  v_current_membership_id uuid;
  v_current_worker_key text;
  v_requested_worker_key text := nullif(lower(btrim(p_worker_key)), '');
begin
  v_role := atlas.current_farm_role(p_farm_id);
  v_current_membership_id := atlas.current_membership_id(p_farm_id);

  if v_role is null or v_current_membership_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  select nullif(lower(btrim(fm.worker_key)), '')
  into v_current_worker_key
  from atlas.farm_memberships fm
  where fm.id = v_current_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

  if v_current_worker_key is null then
    raise exception 'Current Atlas worker identity was not found.' using errcode = 'P0002';
  end if;

  if v_requested_worker_key is not null
     and v_requested_worker_key is distinct from v_current_worker_key
  then
    raise exception 'The home reader may only load the signed-in membership.' using errcode = '42501';
  end if;

  return query
  select card.*
  from atlas.v_task_cards card
  join atlas.tasks task on task.id = card.task_id
  where task.farm_id = p_farm_id
    and task.status <> 'archived'
    and (
      task.visibility_scope = 'farm_shared'
      or (
        task.visibility_scope = 'assigned_worker'
        and task.assigned_membership_id = v_current_membership_id
      )
      or (
        v_role = 'owner'
        and task.visibility_scope = 'owner'
        and (
          task.assigned_membership_id is null
          or task.assigned_membership_id = v_current_membership_id
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
    )
  order by task.due_date nulls last, task.priority, task.created_at;
end;
$function$;

comment on function atlas.home_task_cards_v1(uuid, text, date, date) is
  'Returns one universal home-card shape scoped to the signed-in farm membership. Farm Hands and Managers receive assigned/shared work; Owners also receive owner-scoped work.';
