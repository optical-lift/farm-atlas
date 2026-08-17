begin;

-- Principal OS Milestone 7: the replacement path has been proven and current
-- application callers now use Worker Week directly. Retire the temporary
-- Owner-named aliases without changing Worker execution truth.
do $retirement$
begin
  if to_regclass('atlas.worker_week_projection') is null then
    raise exception 'Cannot retire Owner Week compatibility: canonical atlas.worker_week_projection is missing.';
  end if;

  if to_regprocedure('atlas.refresh_worker_week_projection_v1(uuid,uuid,date,integer)') is null then
    raise exception 'Cannot retire Owner Week compatibility: canonical refresh_worker_week_projection_v1 is missing.';
  end if;
end
$retirement$;

drop view if exists atlas.owner_week_projection;
drop function if exists atlas.refresh_owner_week_projection_v1(uuid,uuid,date,integer);

delete from atlas.authenticated_rpc_registry
where signature = 'atlas.refresh_owner_week_projection_v1(uuid, uuid, date, integer)';

comment on table atlas.worker_week_projection is
  'Canonical Worker scheduling projection. Rows are farm-member work placement truth, not Principal/Owner scheduling truth. Owner Week compatibility has been retired.';

comment on function atlas.refresh_worker_week_projection_v1(uuid,uuid,date,integer) is
  'Canonical secured refresh contract for a farm member Worker week projection. Worker self, farm owner/manager, and service execution are allowed; no Principal scheduling truth is created here.';

commit;
