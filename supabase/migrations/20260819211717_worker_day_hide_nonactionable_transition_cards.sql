create or replace function atlas.worker_day_state_transition_cards_v2(p_farm_id uuid, p_membership_id uuid, p_service_date date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_target atlas.farm_memberships%rowtype;
  v_is_management boolean := false;
  v_cards jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_service_date is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;

  select * into v_target
  from atlas.farm_memberships membership
  where membership.id=p_membership_id and membership.farm_id=p_farm_id and membership.active=true;
  if v_target.id is null then
    raise exception 'Active target membership required.' using errcode='42501';
  end if;

  v_is_management := atlas.is_farm_manager_or_owner(p_farm_id);
  if v_target.user_id is distinct from auth.uid() and not v_is_management then
    raise exception 'Only the routed worker or farm management may read this Worker Day transition packet.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(card.packet
    order by case placement.day_window when 'morning' then 0 when 'afternoon' then 1 when 'evening' then 2 else 3 end,
             placement.sort_order,placement.created_at
  ),'[]'::jsonb)
  into v_cards
  from atlas.worker_day_task_placements placement
  join atlas.tasks task on task.id=placement.task_id
  cross join lateral (
    select atlas.worker_state_transition_card_v2(p_farm_id,p_membership_id,placement.task_id,p_service_date) as packet
  ) card
  where placement.farm_id=p_farm_id
    and placement.membership_id=p_membership_id
    and placement.service_date=p_service_date
    and placement.state='placed'
    and task.status='open'
    and task.assigned_membership_id=p_membership_id
    and coalesce((atlas.task_execution_readiness_v1(task.id)->>'ready')::boolean,false)
    and card.packet#>>'{transition,state}'='authorized_for_routed_day';

  return jsonb_build_object(
    'contractVersion','worker_day_state_transition_cards_v2',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_service_date,
    'cards',v_cards,
    'integrationState','actionable_assigned_today_only',
    'principle','Worker Day contains only open work assigned to this worker, placed for this service date, execution-ready, and authorized now. Upstream blockers belong to the person responsible for clearing them.'
  );
end;
$function$;

create or replace function atlas.worker_day_placed_task_cards_v1(p_farm_id uuid, p_membership_id uuid, p_day date)
 returns setof atlas.v_task_cards
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_allowed boolean:=false;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A worker day is required.' using errcode='22023';
  end if;

  select exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.user_id=auth.uid()
  ) or exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()
  ) into v_allowed;

  if not v_allowed then
    raise exception 'Worker day access required.' using errcode='42501';
  end if;

  return query
  select card.*
  from atlas.worker_day_task_placements p
  join atlas.tasks task on task.id=p.task_id
  join atlas.v_task_cards card on card.task_id=task.id
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id
    and p.service_date=p_day
    and p.state='placed'
    and task.status='open'
    and task.assigned_membership_id=p_membership_id
    and coalesce((atlas.task_execution_readiness_v1(task.id)->>'ready')::boolean,false)
    and atlas.worker_state_transition_card_v2(p_farm_id,p_membership_id,task.id,p_day)#>>'{transition,state}'='authorized_for_routed_day'
  order by case p.day_window when 'morning' then 0 when 'afternoon' then 1 else 2 end,p.sort_order,card.created_at;
end;
$function$;