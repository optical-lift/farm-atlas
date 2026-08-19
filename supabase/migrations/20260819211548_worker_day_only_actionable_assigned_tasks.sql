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

  select coalesce(jsonb_agg(
    atlas.worker_state_transition_card_v2(p_farm_id,p_membership_id,placement.task_id,p_service_date)
    order by case placement.day_window when 'morning' then 0 when 'afternoon' then 1 when 'evening' then 2 else 3 end,
             placement.sort_order,placement.created_at
  ),'[]'::jsonb)
  into v_cards
  from atlas.worker_day_task_placements placement
  join atlas.tasks task on task.id=placement.task_id
  where placement.farm_id=p_farm_id
    and placement.membership_id=p_membership_id
    and placement.service_date=p_service_date
    and placement.state='placed'
    and task.status='open'
    and task.assigned_membership_id=p_membership_id
    and coalesce((atlas.task_execution_readiness_v1(task.id)->>'ready')::boolean,false);

  return jsonb_build_object(
    'contractVersion','worker_day_state_transition_cards_v2',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_service_date,
    'cards',v_cards,
    'integrationState','actionable_assigned_today_only',
    'principle','Worker Day contains only open work assigned to this worker, placed for this service date, and executable now. Upstream blockers belong to the person responsible for clearing them.'
  );
end;
$function$;