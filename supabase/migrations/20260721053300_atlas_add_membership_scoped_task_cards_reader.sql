create or replace function atlas.task_cards_v1(
  p_farm_id uuid,
  p_task_id uuid default null
)
returns setof atlas.v_task_cards
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_role text;
  v_membership_id uuid;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  if v_role is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  v_membership_id := atlas.current_membership_id(p_farm_id);

  return query
  select cards.*
  from atlas.v_task_cards cards
  join atlas.tasks task on task.id = cards.task_id
  where task.farm_id = p_farm_id
    and task.status <> 'archived'
    and (p_task_id is null or task.id = p_task_id)
    and (
      (v_role = 'owner' and task.visibility_scope in ('owner', 'management', 'assigned_worker', 'farm_shared'))
      or (v_role = 'manager' and task.visibility_scope in ('management', 'assigned_worker', 'farm_shared'))
      or (
        v_role = 'farm_hand'
        and (
          (task.visibility_scope = 'assigned_worker' and task.assigned_membership_id = v_membership_id)
          or task.visibility_scope = 'farm_shared'
        )
      )
    )
  order by cards.due_date nulls last, cards.created_at;
end;
$$;

revoke all on function atlas.task_cards_v1(uuid, uuid) from public, anon;
grant execute on function atlas.task_cards_v1(uuid, uuid) to authenticated, service_role;
