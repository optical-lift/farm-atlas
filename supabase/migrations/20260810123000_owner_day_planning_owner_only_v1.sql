create or replace function atlas.owner_worker_day_plan_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
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

  return atlas.owner_worker_day_plan_v1(p_farm_id,p_membership_id,p_day);
end;
$function$;

revoke all on function atlas.owner_worker_day_plan_api_v1(uuid,uuid,date) from public,anon;
grant execute on function atlas.owner_worker_day_plan_api_v1(uuid,uuid,date) to authenticated,service_role;

create or replace function atlas.owner_build_worker_day_schedule_api_v2(
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
  );
end;
$function$;

revoke all on function atlas.owner_build_worker_day_schedule_api_v2(uuid,uuid,date,jsonb) from public,anon;
grant execute on function atlas.owner_build_worker_day_schedule_api_v2(uuid,uuid,date,jsonb) to authenticated,service_role;

update atlas.authenticated_rpc_registry
set evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
      'ownerOnlyPlanning',true,
      'source','owner_day_planning_owner_only_v1',
      'purpose','Owner-only worker-day planning boundary'
    ),
    registered_at=now()
where signature in (
  'atlas.owner_worker_day_plan_api_v1(uuid, uuid, date)',
  'atlas.owner_build_worker_day_schedule_api_v2(uuid, uuid, date, jsonb)'
);
