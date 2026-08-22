create or replace function atlas.worker_self_day_bundle_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_plan jsonb;
  v_task_ids uuid[] := array[]::uuid[];
  v_cards jsonb := '[]'::jsonb;
  v_safe_cards jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A worker day is required.' using errcode='22023';
  end if;
  if not exists(
    select 1
    from atlas.farm_memberships membership
    where membership.id = p_membership_id
      and membership.farm_id = p_farm_id
      and membership.user_id = auth.uid()
      and membership.active = true
      and membership.role = 'farm_hand'
  ) then
    raise exception 'The Farm Hand Worker Day bundle may only be read by that active Farm Hand.' using errcode='42501';
  end if;

  if p_day = v_today then
    v_plan := atlas.worker_day_feed_plan_live_v1(p_farm_id, p_membership_id, p_day);
    v_plan := v_plan || jsonb_build_object(
      'deferredWork', '[]'::jsonb,
      'nextUp', '[]'::jsonb,
      'clockTimeline', jsonb_build_object('items', '[]'::jsonb),
      'nextUpContractVersion', 'worker_self_next_up_deferred_v1',
      'contractVersion', 'worker_self_day_plan_fast_v1'
    );
  else
    v_plan := atlas.worker_self_day_plan_api_v1(p_farm_id, p_membership_id, p_day);
  end if;

  select coalesce(
    array_agg(distinct item.task_id) filter (where item.task_id is not null),
    array[]::uuid[]
  )
  into v_task_ids
  from (
    select nullif(row->>'taskId', '')::uuid as task_id
    from jsonb_array_elements(
      coalesce(v_plan->'realWork', '[]'::jsonb)
      || coalesce(v_plan->'automaticWork', '[]'::jsonb)
    ) row
  ) item;

  if p_day = v_today then
    v_cards := atlas.worker_day_operational_task_cards_v2(
      p_farm_id,
      p_membership_id,
      p_day,
      v_task_ids
    );
  else
    v_cards := atlas.worker_day_operational_task_cards_v3(
      p_farm_id,
      p_membership_id,
      p_day,
      v_task_ids
    );
  end if;

  select coalesce(jsonb_agg(card - 'move_context' order by ord), '[]'::jsonb)
  into v_safe_cards
  from jsonb_array_elements(v_cards) with ordinality as cards(card, ord);

  return jsonb_build_object(
    'contractVersion', 'worker_self_day_bundle_or7_v1',
    'plan', v_plan,
    'taskCards', v_safe_cards
  );
end;
$function$;
