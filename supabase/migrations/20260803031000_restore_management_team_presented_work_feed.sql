create or replace function atlas.home_task_cards_v2(
  p_farm_id uuid,
  p_worker_key text,
  p_due_through date,
  p_done_date date
)
returns setof atlas.v_task_cards
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_membership_id uuid;
  v_worker_key text;
  v_role text;
  v_requested_worker_key text := nullif(lower(btrim(p_worker_key)), '');
begin
  v_membership_id := atlas.current_membership_id(p_farm_id);
  if v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  select nullif(lower(btrim(membership.worker_key)), ''), membership.role
  into v_worker_key, v_role
  from atlas.farm_memberships membership
  where membership.id = v_membership_id
    and membership.farm_id = p_farm_id
    and membership.active = true;

  if v_worker_key is null then
    raise exception 'Current Atlas worker identity was not found.' using errcode = 'P0002';
  end if;

  if v_requested_worker_key is not null and v_requested_worker_key is distinct from v_worker_key then
    raise exception 'The home reader may only load the signed-in membership.' using errcode = '42501';
  end if;

  if v_role in ('owner', 'manager') then
    return query
    with candidates as (
      select
        card as task_card,
        case when membership.id = v_membership_id then 0 else 1 end as viewer_rank,
        case membership.role when 'owner' then 0 when 'manager' then 1 else 2 end as role_rank,
        membership.created_at as membership_created_at
      from atlas.farm_memberships membership
      cross join lateral atlas.home_task_cards_for_membership_v2(
        p_farm_id,
        membership.id,
        p_due_through,
        p_done_date
      ) card
      where membership.farm_id = p_farm_id
        and membership.active = true
    ), picked as (
      select distinct on ((candidate.task_card).task_id)
        candidate.task_card
      from candidates candidate
      order by
        (candidate.task_card).task_id,
        candidate.viewer_rank,
        candidate.role_rank,
        candidate.membership_created_at
    )
    select (picked.task_card).*
    from picked
    order by
      (picked.task_card).due_date nulls last,
      (picked.task_card).created_at,
      (picked.task_card).task_id;
  else
    return query
    select card.*
    from atlas.home_task_cards_for_membership_v2(
      p_farm_id,
      v_membership_id,
      p_due_through,
      p_done_date
    ) card;
  end if;
end;
$function$;

revoke all on function atlas.home_task_cards_v2(uuid, text, date, date) from public;
grant execute on function atlas.home_task_cards_v2(uuid, text, date, date) to authenticated;

with actual as (
  select
    format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature,
    p.prosecdef as security_definer,
    has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
    has_function_privilege('service_role', p.oid, 'execute') as service_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas'
    and p.proname = 'home_task_cards_v2'
    and oidvectortypes(p.proargtypes) = 'uuid, text, date, date'
)
insert into atlas.authenticated_rpc_registry(
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  registered_at,
  reviewed_at
)
select
  actual.signature,
  'policy_or_composition_helper',
  'verified',
  'active',
  actual.authenticated_execute,
  actual.security_definer,
  actual.service_execute,
  0,
  0,
  jsonb_build_object(
    'source', 'management_team_presented_work_feed',
    'call_site', 'Home and dated Work readers',
    'authorization', 'self; management receives deduplicated team Presented Work',
    'reviewed_date', '2026-08-02'
  ),
  now(),
  now()
from actual
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    evidence = atlas.authenticated_rpc_registry.evidence || excluded.evidence,
    reviewed_at = excluded.reviewed_at;
