-- Milestone 7: retire the false Principal/Owner meaning from Worker week projection
-- without changing Worker scheduling truth or existing row identity.

alter table atlas.owner_week_projection rename to worker_week_projection;

alter table atlas.worker_week_projection
  rename constraint owner_week_projection_pkey to worker_week_projection_pkey;
alter table atlas.worker_week_projection
  rename constraint owner_week_projection_farm_id_membership_id_planned_date_so_key
  to worker_week_projection_farm_id_membership_id_planned_date_source_key;
alter table atlas.worker_week_projection
  rename constraint owner_week_projection_plan_state_check to worker_week_projection_plan_state_check;
alter table atlas.worker_week_projection
  rename constraint owner_week_projection_source_kind_check to worker_week_projection_source_kind_check;

alter index if exists atlas.owner_week_projection_day_order_v1
  rename to worker_week_projection_day_order_v1;
alter index if exists atlas.owner_week_projection_member_date_idx
  rename to worker_week_projection_member_date_idx;

comment on table atlas.worker_week_projection is
  'Canonical Worker scheduling projection. Rows are farm-member work placement truth, not Principal/Owner scheduling truth. The former owner_week_projection name is retained only as a read compatibility view.';

-- Preserve the existing refresh implementation as a postgres-only internal engine,
-- then expose a secured Worker-named public contract.
alter function atlas.refresh_owner_week_projection_v1(uuid,uuid,date,integer)
  rename to refresh_worker_week_projection_internal_v1;
alter function atlas.refresh_worker_week_projection_internal_v1(uuid,uuid,date,integer)
  set search_path to pg_catalog, atlas, auth;

-- Rebind the internal implementation to the Worker-named storage.
do $cutover$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='refresh_worker_week_projection_internal_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_start_date date, p_days integer';

  if v_def is null then
    raise exception 'refresh_worker_week_projection_internal_v1 definition not found';
  end if;

  v_def := replace(v_def,'atlas.owner_week_projection','atlas.worker_week_projection');
  execute v_def;
end
$cutover$;

revoke all on function atlas.refresh_worker_week_projection_internal_v1(uuid,uuid,date,integer)
  from public, anon, authenticated, service_role;
grant execute on function atlas.refresh_worker_week_projection_internal_v1(uuid,uuid,date,integer)
  to postgres;
comment on function atlas.refresh_worker_week_projection_internal_v1(uuid,uuid,date,integer) is
  'Internal Worker week projection refresh engine. Not a public API; caller authority is enforced by refresh_worker_week_projection_v1.';

create or replace function atlas.refresh_worker_week_projection_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_start_date date,
  p_days integer default 7
) returns integer
language plpgsql
security definer
set search_path to pg_catalog, atlas, auth
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if p_start_date is null then
    raise exception 'A projection start date is required.' using errcode='22023';
  end if;
  if p_days is null or p_days < 1 or p_days > 31 then
    raise exception 'Projection days must be between 1 and 31.' using errcode='22023';
  end if;

  if not exists (
    select 1
    from atlas.farm_memberships target
    where target.id=p_membership_id
      and target.farm_id=p_farm_id
      and target.active=true
  ) then
    raise exception 'Target membership is not active on this farm.' using errcode='P0002';
  end if;

  if v_user_id is not null and not exists (
    select 1
    from atlas.farm_memberships caller
    where caller.user_id=v_user_id
      and caller.farm_id=p_farm_id
      and caller.active=true
      and (
        caller.id=p_membership_id
        or caller.role in ('owner','manager')
      )
  ) then
    raise exception 'Worker projection refresh requires the target worker or an active farm owner/manager.' using errcode='42501';
  end if;

  return atlas.refresh_worker_week_projection_internal_v1(
    p_farm_id,p_membership_id,p_start_date,p_days
  );
end;
$function$;

revoke all on function atlas.refresh_worker_week_projection_v1(uuid,uuid,date,integer)
  from public, anon;
grant execute on function atlas.refresh_worker_week_projection_v1(uuid,uuid,date,integer)
  to postgres, authenticated, service_role;
comment on function atlas.refresh_worker_week_projection_v1(uuid,uuid,date,integer) is
  'Canonical secured refresh contract for a farm member Worker week projection. Worker self, farm owner/manager, and service execution are allowed; no Principal scheduling truth is created here.';

-- Rebind all proven internal Worker projection readers/writers to the canonical
-- Worker storage and refresh contract. Owner-prefixed mutation APIs remain Owner-
-- prefixed when the name describes the actor who is authoring Worker Day.
do $cutover$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='atlas'
      and p.proname in (
        'deal_next_paid_project_work_v1',
        'deal_next_paid_work_v1',
        'owner_build_worker_day_schedule_v2',
        'pull_project_item_to_today_owner_override_v1',
        'pull_project_item_to_today_v1',
        'worker_future_day_projection_source_v1'
      )
  loop
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def,'atlas.owner_week_projection','atlas.worker_week_projection');
    v_def := replace(v_def,'atlas.refresh_owner_week_projection_v1','atlas.refresh_worker_week_projection_v1');
    execute v_def;
  end loop;
end
$cutover$;

-- The old relation name remains as a read-only compatibility surface for any
-- unindexed application/service reader that has not yet been migrated.
create view atlas.owner_week_projection
with (security_invoker=true)
as
select * from atlas.worker_week_projection;

comment on view atlas.owner_week_projection is
  'LEGACY READ COMPATIBILITY VIEW. Canonical storage is atlas.worker_week_projection. This name must not be used to infer Principal/Owner scheduling authority.';

revoke all on atlas.owner_week_projection from public, anon, authenticated, service_role;
grant select on atlas.owner_week_projection to service_role;

-- Legacy RPC name retained as a secured compatibility shim.
create or replace function atlas.refresh_owner_week_projection_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_start_date date,
  p_days integer default 7
) returns integer
language sql
security definer
set search_path to pg_catalog, atlas, auth
as $function$
  select atlas.refresh_worker_week_projection_v1(
    p_farm_id,p_membership_id,p_start_date,p_days
  );
$function$;

revoke all on function atlas.refresh_owner_week_projection_v1(uuid,uuid,date,integer)
  from public, anon;
grant execute on function atlas.refresh_owner_week_projection_v1(uuid,uuid,date,integer)
  to postgres, authenticated, service_role;
comment on function atlas.refresh_owner_week_projection_v1(uuid,uuid,date,integer) is
  'LEGACY COMPATIBILITY SHIM. Use refresh_worker_week_projection_v1. Retained temporarily so existing callers do not break.';

comment on function atlas.owner_build_worker_day_schedule_v2(uuid,uuid,date,jsonb) is
  'Owner-authoring API for a Farm Hand Worker Day. Owner describes the authoring actor; the schedule truth now persists in worker_week_projection and is not Principal Clock truth.';
comment on function atlas.owner_capacity_plan_v1(uuid,uuid,date) is
  'Owner-only future-tab reader for a target farm member capacity plan. Owner describes the reader/actor; this is Worker execution support, not Principal scheduling truth.';