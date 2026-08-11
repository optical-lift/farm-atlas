-- The active Owner Day scheduler is v2 and now places existing floating work
-- through worker_day_task_placements. Keep the v1 signatures only as bounded
-- compatibility shims so no authenticated or service path can resurrect the old
-- behavior that rewrote an existing floating task's due_date merely to show it
-- on a Day.

create or replace function atlas.owner_build_worker_day_schedule_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  return atlas.owner_build_worker_day_schedule_v2(
    p_farm_id,
    p_membership_id,
    p_day,
    p_selections
  ) || jsonb_build_object('compatibilityEntryPoint','owner_build_worker_day_schedule_v1');
end;
$function$;

revoke all on function atlas.owner_build_worker_day_schedule_v1(uuid,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function atlas.owner_build_worker_day_schedule_v1(uuid,uuid,date,jsonb) to service_role;

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
    select 1
    from atlas.farm_memberships fm
    where fm.user_id=auth.uid()
      and fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='owner'
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists (
    select 1
    from atlas.farm_memberships fm
    where fm.id=p_membership_id
      and fm.farm_id=p_farm_id
      and fm.active=true
      and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;

  return atlas.owner_build_worker_day_schedule_v2(
    p_farm_id,
    p_membership_id,
    p_day,
    p_selections
  ) || jsonb_build_object('compatibilityEntryPoint','owner_build_worker_day_schedule_api_v1');
end;
$function$;

revoke all on function atlas.owner_build_worker_day_schedule_api_v1(uuid,uuid,date,jsonb) from public,anon,service_role;
grant execute on function atlas.owner_build_worker_day_schedule_api_v1(uuid,uuid,date,jsonb) to authenticated;

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
  reviewed_at
)
values
(
  'atlas.owner_build_worker_day_schedule_api_v1(uuid, uuid, date, jsonb)',
  'owner_admin_endpoint',
  'verified',
  'active',
  true,
  true,
  false,
  0,
  0,
  jsonb_build_object(
    'purpose','Compatibility entry point only; delegates to the canonical v2 Owner Day scheduler',
    'authorization','Owner membership plus active Farm Hand target',
    'taskTruthBoundary','Cannot use the retired v1 due-date mutation implementation'
  ),
  now()
),
(
  'atlas.owner_build_worker_day_schedule_api_v2(uuid, uuid, date, jsonb)',
  'owner_admin_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  2,
  0,
  jsonb_build_object(
    'purpose','Canonical Owner Day work-selection endpoint used by the atomic commit and compatibility HTTP schedule route',
    'authorization','Owner membership plus active Farm Hand target',
    'taskTruthBoundary','Existing floating tasks are placed in worker_day_task_placements rather than assigned synthetic due dates'
  ),
  now()
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
