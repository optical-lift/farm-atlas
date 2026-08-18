create or replace function atlas.bridge_flower_harvest_to_production_v1(p_crop_harvest_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_event atlas.crop_harvest_events%rowtype;
  v_lot_id uuid;
  v_lot_count integer := 0;
  v_prod_event_id uuid;
  v_quantity numeric;
  v_exactness text;
  v_more_availability text;
  v_object_id uuid;
  v_reason text;
  v_prod_key text;
begin
  select * into v_event
  from atlas.crop_harvest_events
  where id=p_crop_harvest_event_id;

  if v_event.id is null then
    raise exception 'Crop harvest event not found.' using errcode='P0002';
  end if;

  if coalesce(v_event.metadata->>'physicalOutputMode','')<>'bucket_scale' then
    return jsonb_build_object('state','not_flower_bucket_evidence','cropHarvestEventId',v_event.id);
  end if;

  select count(distinct link.production_lot_id)::integer,
         min(link.production_lot_id::text)::uuid
  into v_lot_count,v_lot_id
  from atlas.production_lot_crop_cycles link
  where link.crop_cycle_id=v_event.crop_cycle_id
    and link.confidence='confirmed';

  if v_lot_count<>1 then
    v_reason := case when v_lot_count=0 then 'no_confirmed_production_lot_lineage' else 'ambiguous_confirmed_production_lot_lineage' end;
    insert into atlas.workflow_events(farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload)
    values (
      v_event.farm_id,'or4:harvest-production-reconciliation:'||v_event.id::text,
      'crop_harvest_event',v_event.id,v_event.id::text,'production_reconciliation_required',v_event.observed_date,
      jsonb_build_object(
        'contractVersion','or4_flower_harvest_result_state_transition_v1','reason',v_reason,
        'confirmedProductionLotCount',v_lot_count,'cropCycleId',v_event.crop_cycle_id,'taskId',v_event.task_id,
        'principle','Harvest completion remains true; Production lineage must not be guessed.'
      )
    ) on conflict (farm_id,event_key) do nothing;
    return jsonb_build_object('state','reconciliation_required','reason',v_reason,'confirmedProductionLotCount',v_lot_count,'cropHarvestEventId',v_event.id);
  end if;

  begin
    v_quantity := nullif(v_event.metadata->>'bucketEquivalentFloor','')::numeric;
  exception when invalid_text_representation then
    v_quantity := null;
  end;
  if v_quantity is null then
    v_reason := 'flower_bucket_quantity_missing';
    insert into atlas.workflow_events(farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload)
    values (
      v_event.farm_id,'or4:harvest-production-reconciliation:'||v_event.id::text,
      'crop_harvest_event',v_event.id,v_event.id::text,'production_reconciliation_required',v_event.observed_date,
      jsonb_build_object(
        'contractVersion','or4_flower_harvest_result_state_transition_v1','reason',v_reason,
        'productionLotId',v_lot_id,'cropCycleId',v_event.crop_cycle_id,
        'principle','Harvest completion remains true; missing measured output is reconciliation debt.'
      )
    ) on conflict (farm_id,event_key) do nothing;
    return jsonb_build_object('state','reconciliation_required','reason',v_reason,'cropHarvestEventId',v_event.id);
  end if;

  v_exactness := case when coalesce(v_event.metadata->>'bucketBand','')='more_than_one' then 'lower_bound' else 'coarse_physical' end;
  v_more_availability := case when v_event.more_available is true then 'yes' when v_event.more_available is false then 'no' else 'unsure' end;
  select object_id into v_object_id from atlas.crop_cycles where id=v_event.crop_cycle_id;
  v_prod_key := 'or4:crop-harvest:'||v_event.id::text;

  select id into v_prod_event_id
  from atlas.production_lot_events
  where farm_id=v_event.farm_id and idempotency_key=v_prod_key;

  if v_prod_event_id is null then
    insert into atlas.production_lot_events(
      farm_id,production_lot_id,event_type,event_date,quantity,unit,task_id,crop_cycle_id,object_id,
      note,source,idempotency_key,metadata
    ) values (
      v_event.farm_id,v_lot_id,'harvest_recorded',v_event.observed_date,v_quantity,'bucket_equivalent',
      v_event.task_id,v_event.crop_cycle_id,v_object_id,v_event.note,'flower_harvest_or4',v_prod_key,
      jsonb_build_object(
        'harvestEvidenceKind','flower_bucket_observation','quantityExactness',v_exactness,
        'bucketBand',v_event.metadata->>'bucketBand','bucketEquivalentFloor',v_quantity,
        'moreAvailability',v_more_availability,'sourceCropHarvestEventId',v_event.id,
        'sourceFlowerHarvestObservationId',v_event.metadata->>'flowerHarvestObservationId',
        'sourceFlowerHarvestBatchId',v_event.metadata->>'flowerHarvestBatchId',
        'harvest_action',case when v_more_availability='no' then 'complete' when v_more_availability='yes' then 'continue' else 'uncertain' end,
        'truthBoundary','actual_harvest_output_evidence'
      )
    ) returning id into v_prod_event_id;
  end if;

  return jsonb_build_object(
    'state','production_evidence_recorded','cropHarvestEventId',v_event.id,'productionLotId',v_lot_id,
    'productionLotEventId',v_prod_event_id,'quantity',v_quantity,'unit','bucket_equivalent',
    'quantityExactness',v_exactness,'moreAvailability',v_more_availability
  );
exception when others then
  begin
    insert into atlas.workflow_events(farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload)
    values (
      v_event.farm_id,'or4:harvest-production-reconciliation:'||v_event.id::text,
      'crop_harvest_event',v_event.id,v_event.id::text,'production_reconciliation_required',
      coalesce(v_event.observed_date,(now() at time zone 'America/Chicago')::date),
      jsonb_build_object(
        'contractVersion','or4_flower_harvest_result_state_transition_v1','reason','production_bridge_failed',
        'error',sqlerrm,'cropCycleId',v_event.crop_cycle_id,'taskId',v_event.task_id,
        'principle','Harvest completion remains true; downstream Production reconciliation failed and must be repaired separately.'
      )
    ) on conflict (farm_id,event_key) do nothing;
  exception when others then null;
  end;
  return jsonb_build_object('state','reconciliation_required','reason','production_bridge_failed','cropHarvestEventId',p_crop_harvest_event_id);
end;
$function$;