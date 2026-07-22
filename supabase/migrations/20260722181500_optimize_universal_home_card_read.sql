-- Filter the signed-in viewer's task ids before opening the aggregate card view.
-- The former join caused v_task_cards to be rebuilt once per eligible task.

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
  v_task_ids uuid[] := '{}'::uuid[];
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

  select coalesce(array_agg(task.id), '{}'::uuid[])
  into v_task_ids
  from atlas.tasks task
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

comment on function atlas.home_task_cards_v1(uuid, text, date, date) is
  'Returns viewer-scoped universal home cards. Eligible task ids are selected first so the aggregate card view is evaluated only for those tasks.';
