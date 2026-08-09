create or replace function atlas.owner_worker_day_floating_candidates_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns table(
  task_id uuid,
  title text,
  expected_active_minutes integer,
  physical_load text,
  environment text,
  priority text,
  effective_obligation_class text,
  sky_preference_order integer,
  obligation_order integer,
  created_at timestamp with time zone
)
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.user_id=auth.uid()
      and fm.farm_id=p_farm_id
      and fm.active
      and fm.role in ('owner','manager')
  ) then
    raise exception 'Owner or manager farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id
      and fm.farm_id=p_farm_id
      and fm.active
      and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  return query
  select * from atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day);
end;
$function$;

revoke all on function atlas.owner_worker_day_floating_candidates_v1(uuid,uuid,date) from public, anon, service_role;
grant execute on function atlas.owner_worker_day_floating_candidates_v1(uuid,uuid,date) to authenticated;

create or replace function atlas.owner_build_worker_day_schedule_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.user_id=auth.uid()
      and fm.farm_id=p_farm_id
      and fm.active
      and fm.role in ('owner','manager')
  ) then
    raise exception 'Owner or manager farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id
      and fm.farm_id=p_farm_id
      and fm.active
      and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  return atlas.owner_build_worker_day_schedule_v1(
    p_farm_id,
    p_membership_id,
    p_day,
    p_selections
  );
end;
$function$;

revoke all on function atlas.owner_build_worker_day_schedule_api_v1(uuid,uuid,date,jsonb) from public, anon, service_role;
grant execute on function atlas.owner_build_worker_day_schedule_api_v1(uuid,uuid,date,jsonb) to authenticated;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at
) values
(
  'atlas.owner_worker_day_floating_candidates_v1(uuid, uuid, date)',
  'owner_admin_endpoint','verified','active',true,true,false,1,0,
  jsonb_build_object('source','owner_day_schedule_authenticated_boundary','purpose','Owner schedule candidate read boundary'),now()
),
(
  'atlas.owner_build_worker_day_schedule_api_v1(uuid, uuid, date, jsonb)',
  'owner_admin_endpoint','verified','active',true,true,false,1,0,
  jsonb_build_object('source','owner_day_schedule_authenticated_boundary','purpose','Owner-approved Farm Hand schedule mutation boundary'),now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=greatest(atlas.authenticated_rpc_registry.caller_count,excluded.caller_count),
    evidence=excluded.evidence,
    registered_at=excluded.registered_at;
