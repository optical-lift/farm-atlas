create or replace function atlas.bridge_production_harvest_lot_to_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle uuid;
begin
  select crop_cycle_id into v_cycle
  from atlas.production_field_stands
  where production_lot_id=new.production_lot_id and stand_status<>'cleared'
  order by created_at limit 1;

  insert into atlas.production_lot_events(
    farm_id,production_lot_id,event_type,event_date,quantity,unit,task_id,crop_cycle_id,note,source,idempotency_key,metadata
  ) values(
    new.farm_id,new.production_lot_id,'harvest_recorded',new.harvest_date,new.marketable_stems,'marketable_stems',new.source_task_id,v_cycle,
    null,'production_harvest_bridge','harvest-lot:'||new.id::text,
    jsonb_build_object(
      'harvest_lot_id',new.id,'harvest_action',new.harvest_action,'marketable_stems',new.marketable_stems,
      'seconds_stems',new.seconds_stems,'discarded_stems',new.discarded_stems,
      'readiness_estimated_marketable_stems',new.readiness_estimated_marketable_stems
    )
  ) on conflict(farm_id,idempotency_key) do nothing;
  return new;
end;
$function$;