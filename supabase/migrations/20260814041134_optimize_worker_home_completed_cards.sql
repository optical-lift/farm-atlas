create or replace function atlas.home_task_cards_for_membership_v3(
  p_farm_id uuid,
  p_membership_id uuid,
  p_due_through date,
  p_done_date date
)
returns setof atlas.v_task_cards
language sql
stable
security definer
set search_path = 'pg_catalog', 'atlas', 'auth'
as $function$
  with all_cards as materialized (
    select * from atlas.v_task_cards
  )
  select card.*
  from atlas.home_task_cards_for_membership_v2(
    p_farm_id,
    p_membership_id,
    p_due_through,
    p_done_date
  ) card

  union

  select card.*
  from all_cards card
  join atlas.tasks task on task.id = card.task_id
  where p_done_date is not null
    and task.farm_id = p_farm_id
    and task.assigned_membership_id = p_membership_id
    and task.parent_task_id is null
    and task.status = 'done'
    and task.completed_at is not null
    and (task.completed_at at time zone 'America/Chicago')::date = p_done_date;
$function$;
