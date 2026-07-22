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
  v_target_membership_id uuid;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  v_current_membership_id := atlas.current_membership_id(p_farm_id);

  if v_role is null or v_current_membership_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  if v_role = 'farm_hand' then
    v_target_membership_id := v_current_membership_id;
  else
    select fm.id
    into v_target_membership_id
    from atlas.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.active = true
      and fm.worker_key = nullif(lower(btrim(p_worker_key)), '')
    order by fm.created_at
    limit 1;

    if v_target_membership_id is null then
      raise exception 'Target Farm Hand membership was not found.' using errcode = 'P0002';
    end if;
  end if;

  return query
  select card.*
  from atlas.v_task_cards card
  join atlas.tasks task on task.id = card.task_id
  where task.farm_id = p_farm_id
    and task.status <> 'archived'
    and (
      (task.visibility_scope = 'assigned_worker' and task.assigned_membership_id = v_target_membership_id)
      or task.visibility_scope = 'farm_shared'
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

revoke all on function atlas.home_task_cards_v1(uuid, text, date, date) from public, anon;
grant execute on function atlas.home_task_cards_v1(uuid, text, date, date) to authenticated, service_role;
