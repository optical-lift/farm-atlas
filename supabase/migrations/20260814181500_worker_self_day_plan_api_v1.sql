begin;

create or replace function atlas.worker_self_day_plan_api_v1(
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
  v_plan jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A worker day is required.' using errcode='22023';
  end if;
  if not exists (
    select 1
    from atlas.farm_memberships membership
    where membership.id=p_membership_id
      and membership.farm_id=p_farm_id
      and membership.user_id=auth.uid()
      and membership.active=true
      and membership.role='farm_hand'
  ) then
    raise exception 'The Farm Hand Worker Day plan may only be read by that active Farm Hand.' using errcode='42501';
  end if;

  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_plan:=jsonb_set(v_plan,'{suggestions}','[]'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{contractVersion}',to_jsonb('worker_self_day_plan_v1'::text),true);
  return v_plan;
end;
$function$;

revoke all on function atlas.worker_self_day_plan_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.worker_self_day_plan_api_v1(uuid,uuid,date) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry (
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
  reviewed_at
)
values (
  'atlas.worker_self_day_plan_api_v1(uuid, uuid, date)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Read the same canonical choreographed Worker Day planner used by Owner while removing Owner-only proposal suggestions',
    'boundary','active Farm Hand may read only their own membership on their farm',
    'privacy','proposal suggestions remain Owner-only; committed and automatic Worker Day truth is shared',
    'architecture','server sequence endpoint replaces the Farm Hand client-side fallback scheduler'
  ),now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;

commit;
