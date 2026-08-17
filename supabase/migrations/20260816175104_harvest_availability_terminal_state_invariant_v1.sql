create or replace function atlas.normalize_finished_harvest_availability_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
begin
  if new.status='finished' then
    new.current_watch_task_id:=null;
    new.current_watch_occurrence_id:=null;
    new.current_harvest_task_id:=null;
    new.current_harvest_occurrence_id:=null;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'tasklessForecast',false,
      'harvestHorizonActive',false,
      'terminalStateNormalized',true
    );
  end if;
  return new;
end;
$$;

revoke all on function atlas.normalize_finished_harvest_availability_v1() from public, anon, authenticated;

DROP TRIGGER IF EXISTS crop_harvest_availability_terminal_normalize_v1 ON atlas.crop_harvest_availability;
create trigger crop_harvest_availability_terminal_normalize_v1
before insert or update on atlas.crop_harvest_availability
for each row execute function atlas.normalize_finished_harvest_availability_v1();

update atlas.authenticated_rpc_registry
set confidence='verified',
    evidence=evidence || jsonb_build_object(
      'releaseVerification','Rollback-only two-cut acceptance passed: harvested_more produced taskless Harvest Horizon continuation; harvested_finished produced terminal finished availability.',
      'continuityTruth','more_available=true persists a taskless Harvest Horizon obligation rather than silently disappearing',
      'terminalTruth','finished availability now enforces null work pointers and inactive horizon metadata'
    ),
    reviewed_at=now()
where signature='atlas.record_crop_harvest_cut_for_member_v1(uuid, uuid, numeric, numeric, numeric, text, boolean, text, text)';