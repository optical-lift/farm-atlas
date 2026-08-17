create or replace function atlas.production_lot_reforecast_preview_v1(
  p_production_lot_id uuid,
  p_source_event_id uuid default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_lot atlas.production_lots%rowtype;
  v_profile atlas.crop_profiles%rowtype;
  v_source atlas.production_lot_events%rowtype;
  v_actual_sow date;
  v_actual_germination date;
  v_actual_transplant date;
  v_actual_established date;
  v_actual_harvest_ready date;
  v_actual_harvest date;
  v_actual_clear date;
  v_actual_turnover date;
  v_seed_qty numeric;
  v_germ_qty numeric;
  v_transplant_qty numeric;
  v_established_qty numeric;
  v_harvest_marketable numeric;
  v_harvest_seconds numeric;
  v_harvest_discarded numeric;
  v_labor_actual_count integer:=0;
  v_labor_actual_minutes integer:=0;
  v_latest_labor_date date;
  v_ready_min integer;
  v_ready_max integer;
  v_projected_transplant_start date;
  v_projected_transplant_end date;
  v_projected_harvest_start date;
  v_projected_harvest_end date;
  v_sow_variance integer;
  v_transplant_start_variance integer;
  v_transplant_end_variance integer;
  v_harvest_start_variance integer;
  v_harvest_end_variance integer;
  v_tentative_reservations integer:=0;
  v_confirmed_reservations integer:=0;
  v_bed_recommit integer:=0;
  v_material boolean:=false;
  v_quantity_changed boolean:=false;
begin
  select * into v_lot from atlas.production_lots where id=p_production_lot_id;
  if v_lot.id is null then raise exception 'Production lot was not found' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_lot.farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  select * into v_profile from atlas.crop_profiles where id=v_lot.crop_profile_id;

  if p_source_event_id is not null then
    select * into v_source from atlas.production_lot_events where id=p_source_event_id and production_lot_id=v_lot.id;
    if v_source.id is null then raise exception 'Source event does not belong to this production lot' using errcode='22023'; end if;
  else
    select * into v_source from atlas.production_lot_events where production_lot_id=v_lot.id order by event_date desc,created_at desc limit 1;
  end if;

  select event_date,quantity into v_actual_sow,v_seed_qty from atlas.production_lot_events where production_lot_id=v_lot.id and event_type='sown' order by event_date desc,created_at desc limit 1;
  select event_date,quantity into v_actual_germination,v_germ_qty from atlas.production_lot_events where production_lot_id=v_lot.id and event_type='germinated' order by event_date desc,created_at desc limit 1;
  select event_date,quantity into v_actual_transplant,v_transplant_qty from atlas.production_lot_events where production_lot_id=v_lot.id and event_type='transplanted' order by event_date desc,created_at desc limit 1;
  select event_date,quantity into v_actual_established,v_established_qty from atlas.production_lot_events where production_lot_id=v_lot.id and event_type='established' order by event_date desc,created_at desc limit 1;
  select event_date into v_actual_harvest_ready from atlas.production_lot_events where production_lot_id=v_lot.id and event_type='harvest_readiness_confirmed' order by event_date desc,created_at desc limit 1;
  select event_date into v_actual_clear from atlas.production_lot_events where production_lot_id=v_lot.id and event_type='cleared' order by event_date desc,created_at desc limit 1;
  select event_date into v_actual_turnover from atlas.production_lot_events where production_lot_id=v_lot.id and event_type='turnover_completed' order by event_date desc,created_at desc limit 1;

  select min(event_date),coalesce(sum((metadata->>'marketable_stems')::numeric),0),coalesce(sum((metadata->>'seconds_stems')::numeric),0),coalesce(sum((metadata->>'discarded_stems')::numeric),0)
  into v_actual_harvest,v_harvest_marketable,v_harvest_seconds,v_harvest_discarded
  from atlas.production_lot_events where production_lot_id=v_lot.id and event_type='harvest_recorded';

  select count(*)::integer,coalesce(sum(actual_minutes),0)::integer,max(observed_date)
  into v_labor_actual_count,v_labor_actual_minutes,v_latest_labor_date
  from atlas.production_operation_actuals where production_lot_id=v_lot.id;

  begin
    v_ready_min:=nullif(v_profile.metadata->>'transplant_ready_days_min','')::integer;
    v_ready_max:=nullif(v_profile.metadata->>'transplant_ready_days_max','')::integer;
  exception when others then v_ready_min:=null;v_ready_max:=null; end;

  v_projected_transplant_start:=v_lot.expected_transplant_start;
  v_projected_transplant_end:=v_lot.expected_transplant_end;
  if v_actual_sow is not null and v_ready_min is not null and v_ready_max is not null then
    v_projected_transplant_start:=v_actual_sow+v_ready_min;
    v_projected_transplant_end:=v_actual_sow+v_ready_max;
  end if;

  v_projected_harvest_start:=v_lot.expected_harvest_start;
  v_projected_harvest_end:=v_lot.expected_harvest_end;
  if v_actual_transplant is not null and v_profile.days_to_harvest_watch_min is not null and v_profile.days_to_harvest_watch_max is not null then
    v_projected_harvest_start:=v_actual_transplant+v_profile.days_to_harvest_watch_min;
    v_projected_harvest_end:=v_actual_transplant+v_profile.days_to_harvest_watch_max;
  end if;
  if v_actual_harvest_ready is not null then
    v_projected_harvest_start:=v_actual_harvest_ready;
    if v_profile.productive_days_max is not null then v_projected_harvest_end:=v_actual_harvest_ready+v_profile.productive_days_max;
    elsif v_projected_harvest_end is not null and v_projected_harvest_end<v_actual_harvest_ready then v_projected_harvest_end:=null; end if;
  end if;
  if v_actual_harvest is not null then
    v_projected_harvest_start:=v_actual_harvest;
    if v_profile.productive_days_max is not null then v_projected_harvest_end:=v_actual_harvest+v_profile.productive_days_max; end if;
  end if;

  v_sow_variance:=case when v_actual_sow is not null and v_lot.planned_sow_date is not null then v_actual_sow-v_lot.planned_sow_date end;
  v_transplant_start_variance:=case when v_projected_transplant_start is not null and v_lot.expected_transplant_start is not null then v_projected_transplant_start-v_lot.expected_transplant_start end;
  v_transplant_end_variance:=case when v_projected_transplant_end is not null and v_lot.expected_transplant_end is not null then v_projected_transplant_end-v_lot.expected_transplant_end end;
  v_harvest_start_variance:=case when v_projected_harvest_start is not null and v_lot.expected_harvest_start is not null then v_projected_harvest_start-v_lot.expected_harvest_start end;
  v_harvest_end_variance:=case when v_projected_harvest_end is not null and v_lot.expected_harvest_end is not null then v_projected_harvest_end-v_lot.expected_harvest_end end;

  select count(*) filter(where reservation_status='tentative'),count(*) filter(where reservation_status='confirmed') into v_tentative_reservations,v_confirmed_reservations from atlas.production_capacity_reservations where production_lot_id=v_lot.id;
  select count(*) into v_bed_recommit from atlas.production_bed_assignments where production_lot_id=v_lot.id and assignment_status='assigned' and planned_transplant_date is not null and v_projected_transplant_start is not null and planned_transplant_date<>v_projected_transplant_start;

  v_quantity_changed := (v_seed_qty is not null and v_germ_qty is not null and v_germ_qty<>v_seed_qty)
    or (v_germ_qty is not null and v_transplant_qty is not null and v_transplant_qty<>v_germ_qty)
    or (v_transplant_qty is not null and v_established_qty is not null and v_established_qty<>v_transplant_qty);
  v_material := coalesce(v_sow_variance,0)<>0 or coalesce(v_transplant_start_variance,0)<>0 or coalesce(v_transplant_end_variance,0)<>0 or coalesce(v_harvest_start_variance,0)<>0 or coalesce(v_harvest_end_variance,0)<>0 or v_quantity_changed;

  return jsonb_build_object(
    'contractVersion','production_lot_reforecast_preview_v2','farmId',v_lot.farm_id,'productionLotId',v_lot.id,'lotLabel',v_lot.lot_label,
    'sourceEvent',case when v_source.id is null then null else jsonb_build_object('eventId',v_source.id,'eventType',v_source.event_type,'eventDate',v_source.event_date) end,
    'actualAnchors',jsonb_strip_nulls(jsonb_build_object('sownDate',v_actual_sow,'germinatedDate',v_actual_germination,'transplantedDate',v_actual_transplant,'establishedDate',v_actual_established,'harvestReadyDate',v_actual_harvest_ready,'firstHarvestDate',v_actual_harvest,'clearedDate',v_actual_clear,'turnoverCompletedDate',v_actual_turnover)),
    'quantityEvidence',jsonb_strip_nulls(jsonb_build_object('seedsSown',v_seed_qty,'germinatedSeedlings',v_germ_qty,'plantsTransplanted',v_transplant_qty,'plantsEstablished',v_established_qty,'harvestedMarketableStems',v_harvest_marketable,'harvestedSecondsStems',v_harvest_seconds,'harvestedDiscardedStems',v_harvest_discarded,'germinationRate',case when coalesce(v_seed_qty,0)>0 and v_germ_qty is not null then round(v_germ_qty/v_seed_qty,4) end,'establishmentSurvivalRate',case when coalesce(v_transplant_qty,0)>0 and v_established_qty is not null then round(v_established_qty/v_transplant_qty,4) end,'quantityEvidenceChanged',v_quantity_changed,'materialityThresholdState','not_configured')),
    'priorProjection',jsonb_build_object('plannedSowDate',v_lot.planned_sow_date,'expectedTransplantStart',v_lot.expected_transplant_start,'expectedTransplantEnd',v_lot.expected_transplant_end,'expectedHarvestStart',v_lot.expected_harvest_start,'expectedHarvestEnd',v_lot.expected_harvest_end),
    'nextProjection',jsonb_build_object('expectedTransplantStart',v_projected_transplant_start,'expectedTransplantEnd',v_projected_transplant_end,'expectedHarvestStart',v_projected_harvest_start,'expectedHarvestEnd',v_projected_harvest_end,'transplantSource',case when v_actual_sow is not null and v_ready_min is not null then 'actual_sow_plus_profile_transplant_ready_days' else 'existing_projection' end,'harvestSource',case when v_actual_harvest is not null then 'actual_counted_harvest' when v_actual_harvest_ready is not null then 'actual_harvest_readiness' when v_actual_transplant is not null and v_profile.days_to_harvest_watch_min is not null then 'actual_transplant_plus_crop_profile_harvest_days' else 'existing_or_unknown_projection' end),
    'varianceDays',jsonb_strip_nulls(jsonb_build_object('actualSowVsPlanned',v_sow_variance,'transplantStart',v_transplant_start_variance,'transplantEnd',v_transplant_end_variance,'harvestStart',v_harvest_start_variance,'harvestEnd',v_harvest_end_variance)),
    'downstreamCommitmentImpact',jsonb_build_object('tentativeCapacityReservationsMovable',v_tentative_reservations,'confirmedCapacityReservationsRequireRecommit',v_confirmed_reservations,'assignedBedPlacementsRequireRecommit',v_bed_recommit,'confirmedCommitmentsAutoMoved',false),
    'materialChange',v_material,
    'laborActuals',jsonb_build_object('state',case when v_labor_actual_count>0 then 'recorded' else 'no_actuals_recorded' end,'actualCount',v_labor_actual_count,'totalActualMinutes',v_labor_actual_minutes,'latestActualDate',v_latest_labor_date,'learningSurface','production_operation_labor_evidence_v1'),
    'clearTurnoverActuals',jsonb_build_object('state',case when v_actual_turnover is not null then 'turnover_completed' when v_actual_clear is not null then 'cleared_awaiting_turnover' else 'not_yet_recorded' end,'clearedDate',v_actual_clear,'turnoverCompletedDate',v_actual_turnover,'clearRecorder','record_production_clear_v1','turnoverRecorder','record_production_turnover_v1'),
    'farmTruthMutated',false
  );
end;
$function$;