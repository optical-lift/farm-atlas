create table if not exists atlas.production_reforecast_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id),
  production_lot_id uuid not null references atlas.production_lots(id),
  source_event_id uuid references atlas.production_lot_events(id),
  source_event_type text,
  source_event_date date,
  reforecast_version text not null default 'production_actual_reforecast_v1',
  prior_projection jsonb not null default '{}'::jsonb,
  next_projection jsonb not null default '{}'::jsonb,
  changes jsonb not null default '{}'::jsonb,
  material_change boolean not null default false,
  applied boolean not null default false,
  created_at timestamptz not null default now(),
  unique(source_event_id,reforecast_version)
);

create index if not exists production_reforecast_events_lot_date_idx
  on atlas.production_reforecast_events(production_lot_id,created_at desc);

alter table atlas.production_reforecast_events enable row level security;
revoke all on atlas.production_reforecast_events from public, anon, authenticated;
grant all on atlas.production_reforecast_events to service_role;

create or replace function atlas.prevent_production_reforecast_event_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  raise exception 'Production reforecast events are append-only; write a new reforecast event instead';
end;
$function$;

drop trigger if exists prevent_production_reforecast_event_mutation on atlas.production_reforecast_events;
create trigger prevent_production_reforecast_event_mutation
before update or delete on atlas.production_reforecast_events
for each row execute function atlas.prevent_production_reforecast_event_mutation_v1();

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
  v_seed_qty numeric;
  v_germ_qty numeric;
  v_transplant_qty numeric;
  v_established_qty numeric;
  v_harvest_marketable numeric;
  v_harvest_seconds numeric;
  v_harvest_discarded numeric;
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
    select * into v_source
    from atlas.production_lot_events
    where production_lot_id=v_lot.id
    order by event_date desc,created_at desc
    limit 1;
  end if;

  select event_date,quantity into v_actual_sow,v_seed_qty
  from atlas.production_lot_events
  where production_lot_id=v_lot.id and event_type='sown'
  order by event_date desc,created_at desc limit 1;

  select event_date,quantity into v_actual_germination,v_germ_qty
  from atlas.production_lot_events
  where production_lot_id=v_lot.id and event_type='germinated'
  order by event_date desc,created_at desc limit 1;

  select event_date,quantity into v_actual_transplant,v_transplant_qty
  from atlas.production_lot_events
  where production_lot_id=v_lot.id and event_type='transplanted'
  order by event_date desc,created_at desc limit 1;

  select event_date,quantity into v_actual_established,v_established_qty
  from atlas.production_lot_events
  where production_lot_id=v_lot.id and event_type='established'
  order by event_date desc,created_at desc limit 1;

  select event_date into v_actual_harvest_ready
  from atlas.production_lot_events
  where production_lot_id=v_lot.id and event_type='harvest_readiness_confirmed'
  order by event_date desc,created_at desc limit 1;

  select min(event_date),
         coalesce(sum((metadata->>'marketable_stems')::numeric),0),
         coalesce(sum((metadata->>'seconds_stems')::numeric),0),
         coalesce(sum((metadata->>'discarded_stems')::numeric),0)
  into v_actual_harvest,v_harvest_marketable,v_harvest_seconds,v_harvest_discarded
  from atlas.production_lot_events
  where production_lot_id=v_lot.id and event_type='harvest_recorded';

  begin
    v_ready_min:=nullif(v_profile.metadata->>'transplant_ready_days_min','')::integer;
    v_ready_max:=nullif(v_profile.metadata->>'transplant_ready_days_max','')::integer;
  exception when others then
    v_ready_min:=null;v_ready_max:=null;
  end;

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
    if v_profile.productive_days_max is not null then
      v_projected_harvest_end:=v_actual_harvest_ready+v_profile.productive_days_max;
    elsif v_projected_harvest_end is not null and v_projected_harvest_end<v_actual_harvest_ready then
      v_projected_harvest_end:=null;
    end if;
  end if;
  if v_actual_harvest is not null then
    v_projected_harvest_start:=v_actual_harvest;
    if v_profile.productive_days_max is not null then
      v_projected_harvest_end:=v_actual_harvest+v_profile.productive_days_max;
    end if;
  end if;

  v_sow_variance:=case when v_actual_sow is not null and v_lot.planned_sow_date is not null then v_actual_sow-v_lot.planned_sow_date end;
  v_transplant_start_variance:=case when v_projected_transplant_start is not null and v_lot.expected_transplant_start is not null then v_projected_transplant_start-v_lot.expected_transplant_start end;
  v_transplant_end_variance:=case when v_projected_transplant_end is not null and v_lot.expected_transplant_end is not null then v_projected_transplant_end-v_lot.expected_transplant_end end;
  v_harvest_start_variance:=case when v_projected_harvest_start is not null and v_lot.expected_harvest_start is not null then v_projected_harvest_start-v_lot.expected_harvest_start end;
  v_harvest_end_variance:=case when v_projected_harvest_end is not null and v_lot.expected_harvest_end is not null then v_projected_harvest_end-v_lot.expected_harvest_end end;

  select count(*) filter(where reservation_status='tentative'),count(*) filter(where reservation_status='confirmed')
  into v_tentative_reservations,v_confirmed_reservations
  from atlas.production_capacity_reservations where production_lot_id=v_lot.id;

  select count(*) into v_bed_recommit
  from atlas.production_bed_assignments
  where production_lot_id=v_lot.id and assignment_status='assigned'
    and planned_transplant_date is not null and v_projected_transplant_start is not null
    and planned_transplant_date<>v_projected_transplant_start;

  v_quantity_changed := (v_seed_qty is not null and v_germ_qty is not null and v_germ_qty<>v_seed_qty)
    or (v_germ_qty is not null and v_transplant_qty is not null and v_transplant_qty<>v_germ_qty)
    or (v_transplant_qty is not null and v_established_qty is not null and v_established_qty<>v_transplant_qty);

  v_material := coalesce(v_sow_variance,0)<>0
    or coalesce(v_transplant_start_variance,0)<>0
    or coalesce(v_transplant_end_variance,0)<>0
    or coalesce(v_harvest_start_variance,0)<>0
    or coalesce(v_harvest_end_variance,0)<>0
    or v_quantity_changed;

  return jsonb_build_object(
    'contractVersion','production_lot_reforecast_preview_v1',
    'farmId',v_lot.farm_id,
    'productionLotId',v_lot.id,
    'lotLabel',v_lot.lot_label,
    'sourceEvent',case when v_source.id is null then null else jsonb_build_object('eventId',v_source.id,'eventType',v_source.event_type,'eventDate',v_source.event_date) end,
    'actualAnchors',jsonb_strip_nulls(jsonb_build_object(
      'sownDate',v_actual_sow,'germinatedDate',v_actual_germination,'transplantedDate',v_actual_transplant,
      'establishedDate',v_actual_established,'harvestReadyDate',v_actual_harvest_ready,'firstHarvestDate',v_actual_harvest
    )),
    'quantityEvidence',jsonb_strip_nulls(jsonb_build_object(
      'seedsSown',v_seed_qty,'germinatedSeedlings',v_germ_qty,'plantsTransplanted',v_transplant_qty,
      'plantsEstablished',v_established_qty,'harvestedMarketableStems',v_harvest_marketable,
      'harvestedSecondsStems',v_harvest_seconds,'harvestedDiscardedStems',v_harvest_discarded,
      'germinationRate',case when coalesce(v_seed_qty,0)>0 and v_germ_qty is not null then round(v_germ_qty/v_seed_qty,4) end,
      'establishmentSurvivalRate',case when coalesce(v_transplant_qty,0)>0 and v_established_qty is not null then round(v_established_qty/v_transplant_qty,4) end,
      'quantityEvidenceChanged',v_quantity_changed,'materialityThresholdState','not_configured'
    )),
    'priorProjection',jsonb_build_object(
      'plannedSowDate',v_lot.planned_sow_date,'expectedTransplantStart',v_lot.expected_transplant_start,
      'expectedTransplantEnd',v_lot.expected_transplant_end,'expectedHarvestStart',v_lot.expected_harvest_start,
      'expectedHarvestEnd',v_lot.expected_harvest_end
    ),
    'nextProjection',jsonb_build_object(
      'expectedTransplantStart',v_projected_transplant_start,'expectedTransplantEnd',v_projected_transplant_end,
      'expectedHarvestStart',v_projected_harvest_start,'expectedHarvestEnd',v_projected_harvest_end,
      'transplantSource',case when v_actual_sow is not null and v_ready_min is not null then 'actual_sow_plus_profile_transplant_ready_days' else 'existing_projection' end,
      'harvestSource',case when v_actual_harvest is not null then 'actual_counted_harvest' when v_actual_harvest_ready is not null then 'actual_harvest_readiness' when v_actual_transplant is not null and v_profile.days_to_harvest_watch_min is not null then 'actual_transplant_plus_crop_profile_harvest_days' else 'existing_or_unknown_projection' end
    ),
    'varianceDays',jsonb_strip_nulls(jsonb_build_object(
      'actualSowVsPlanned',v_sow_variance,'transplantStart',v_transplant_start_variance,'transplantEnd',v_transplant_end_variance,
      'harvestStart',v_harvest_start_variance,'harvestEnd',v_harvest_end_variance
    )),
    'downstreamCommitmentImpact',jsonb_build_object(
      'tentativeCapacityReservationsMovable',v_tentative_reservations,
      'confirmedCapacityReservationsRequireRecommit',v_confirmed_reservations,
      'assignedBedPlacementsRequireRecommit',v_bed_recommit,
      'confirmedCommitmentsAutoMoved',false
    ),
    'materialChange',v_material,
    'laborActuals',jsonb_build_object('state','partial','reason','Atlas has operation-specific actual-minute ledgers for some maintenance/weed work, but no canonical all-production-operation labor actual event yet.'),
    'clearTurnoverActuals',jsonb_build_object('state','write_contract_missing','reason','No canonical Production Lot clear/turnover actual recorder is installed yet.'),
    'farmTruthMutated',false
  );
end;
$function$;

create or replace function atlas.apply_production_lot_reforecast_v1(
  p_production_lot_id uuid,
  p_source_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_lot atlas.production_lots%rowtype;
  v_source atlas.production_lot_events%rowtype;
  v_preview jsonb;
  v_prior jsonb;
  v_next jsonb;
  v_existing atlas.production_reforecast_events%rowtype;
  v_new_transplant_start date;
  v_new_transplant_end date;
  v_new_harvest_start date;
  v_new_harvest_end date;
  v_sow_delta integer:=0;
  v_moved_requirements integer:=0;
  v_moved_tentative integer:=0;
  v_confirmed integer:=0;
  v_bed_recommit integer:=0;
  v_event_id uuid;
begin
  select * into v_lot from atlas.production_lots where id=p_production_lot_id for update;
  if v_lot.id is null then raise exception 'Production lot was not found' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_lot.farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  select * into v_source from atlas.production_lot_events where id=p_source_event_id and production_lot_id=v_lot.id;
  if v_source.id is null then raise exception 'Source event does not belong to this production lot' using errcode='22023'; end if;

  select * into v_existing from atlas.production_reforecast_events where source_event_id=p_source_event_id and reforecast_version='production_actual_reforecast_v1';
  if v_existing.id is not null then
    return jsonb_build_object('reforecastEventId',v_existing.id,'productionLotId',v_lot.id,'deduplicated',true,'applied',v_existing.applied,'changes',v_existing.changes);
  end if;

  v_preview:=atlas.production_lot_reforecast_preview_v1(v_lot.id,v_source.id);
  v_prior:=v_preview->'priorProjection';
  v_next:=v_preview->'nextProjection';
  v_new_transplant_start:=nullif(v_next->>'expectedTransplantStart','')::date;
  v_new_transplant_end:=nullif(v_next->>'expectedTransplantEnd','')::date;
  v_new_harvest_start:=nullif(v_next->>'expectedHarvestStart','')::date;
  v_new_harvest_end:=nullif(v_next->>'expectedHarvestEnd','')::date;
  v_sow_delta:=coalesce(nullif(v_preview->'varianceDays'->>'actualSowVsPlanned','')::integer,0);

  update atlas.production_lots
  set
    expected_transplant_start=coalesce(v_new_transplant_start,expected_transplant_start),
    expected_transplant_end=coalesce(v_new_transplant_end,expected_transplant_end),
    expected_harvest_start=coalesce(v_new_harvest_start,expected_harvest_start),
    expected_harvest_end=coalesce(v_new_harvest_end,expected_harvest_end),
    metadata=coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'reforecastVersion','production_actual_reforecast_v1',
        'lastReforecastSourceEventId',v_source.id,
        'lastReforecastSourceEventType',v_source.event_type,
        'lastReforecastAt',now(),
        'reforecastBaselineExpectedTransplantStart',coalesce(metadata->'reforecastBaselineExpectedTransplantStart',to_jsonb(expected_transplant_start)),
        'reforecastBaselineExpectedTransplantEnd',coalesce(metadata->'reforecastBaselineExpectedTransplantEnd',to_jsonb(expected_transplant_end)),
        'reforecastBaselineExpectedHarvestStart',coalesce(metadata->'reforecastBaselineExpectedHarvestStart',to_jsonb(expected_harvest_start)),
        'reforecastBaselineExpectedHarvestEnd',coalesce(metadata->'reforecastBaselineExpectedHarvestEnd',to_jsonb(expected_harvest_end))
      ),
    updated_at=now()
  where id=v_lot.id;

  if v_sow_delta<>0 then
    update atlas.production_capacity_requirements r
    set
      required_by_date=case
        when r.metadata ? 'reforecastBaselineRequiredByDate' then (r.metadata->>'reforecastBaselineRequiredByDate')::date+v_sow_delta
        when r.required_by_date is not null then r.required_by_date+v_sow_delta else null end,
      window_start=case
        when r.metadata ? 'reforecastBaselineWindowStart' then (r.metadata->>'reforecastBaselineWindowStart')::date+v_sow_delta
        when r.window_start is not null then r.window_start+v_sow_delta else null end,
      window_end=case
        when r.metadata ? 'reforecastBaselineWindowEnd' then (r.metadata->>'reforecastBaselineWindowEnd')::date+v_sow_delta
        when r.window_end is not null then r.window_end+v_sow_delta else null end,
      preparation_due_date=case
        when r.metadata ? 'reforecastBaselinePreparationDueDate' then (r.metadata->>'reforecastBaselinePreparationDueDate')::date+v_sow_delta
        when r.preparation_due_date is not null then r.preparation_due_date+v_sow_delta else null end,
      metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object(
        'reforecastBaselineRequiredByDate',coalesce(r.metadata->>'reforecastBaselineRequiredByDate',r.required_by_date::text),
        'reforecastBaselineWindowStart',coalesce(r.metadata->>'reforecastBaselineWindowStart',r.window_start::text),
        'reforecastBaselineWindowEnd',coalesce(r.metadata->>'reforecastBaselineWindowEnd',r.window_end::text),
        'reforecastBaselinePreparationDueDate',coalesce(r.metadata->>'reforecastBaselinePreparationDueDate',r.preparation_due_date::text),
        'reforecastSourceEventId',v_source.id,'reforecastSowDeltaDays',v_sow_delta
      )),updated_at=now()
    where r.production_lot_id=v_lot.id
      and r.stage_key in ('seed_starting','seedling_care','transplant')
      and r.calculation_status in ('blocked','calculated','confirmed');
    get diagnostics v_moved_requirements=row_count;

    update atlas.production_capacity_reservations r
    set
      window_start=case
        when r.metadata ? 'reforecastBaselineWindowStart' then (r.metadata->>'reforecastBaselineWindowStart')::date+v_sow_delta
        else r.window_start+v_sow_delta end,
      window_end=case
        when r.metadata ? 'reforecastBaselineWindowEnd' then (r.metadata->>'reforecastBaselineWindowEnd')::date+v_sow_delta
        else r.window_end+v_sow_delta end,
      metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object(
        'reforecastBaselineWindowStart',coalesce(r.metadata->>'reforecastBaselineWindowStart',r.window_start::text),
        'reforecastBaselineWindowEnd',coalesce(r.metadata->>'reforecastBaselineWindowEnd',r.window_end::text),
        'reforecastSourceEventId',v_source.id,'reforecastSowDeltaDays',v_sow_delta
      ),updated_at=now()
    where r.production_lot_id=v_lot.id and r.reservation_status='tentative';
    get diagnostics v_moved_tentative=row_count;
  end if;

  select count(*) into v_confirmed from atlas.production_capacity_reservations where production_lot_id=v_lot.id and reservation_status='confirmed';
  select count(*) into v_bed_recommit
  from atlas.production_bed_assignments
  where production_lot_id=v_lot.id and assignment_status='assigned'
    and planned_transplant_date is not null and v_new_transplant_start is not null
    and planned_transplant_date<>v_new_transplant_start;

  insert into atlas.production_reforecast_events(
    farm_id,production_lot_id,source_event_id,source_event_type,source_event_date,reforecast_version,
    prior_projection,next_projection,changes,material_change,applied
  ) values(
    v_lot.farm_id,v_lot.id,v_source.id,v_source.event_type,v_source.event_date,'production_actual_reforecast_v1',
    v_prior,v_next,
    jsonb_build_object(
      'movedDerivedCapacityRequirementCount',v_moved_requirements,
      'movedTentativeCapacityReservationCount',v_moved_tentative,
      'confirmedCapacityReservationRecommitCount',v_confirmed,
      'assignedBedPlacementRecommitCount',v_bed_recommit,
      'confirmedCommitmentsAutoMoved',false,
      'sowDeltaDays',v_sow_delta,
      'laborModelLearningApplied',false,
      'clearTurnoverReforecastApplied',false
    ),
    coalesce((v_preview->>'materialChange')::boolean,false),true
  ) returning id into v_event_id;

  return jsonb_build_object(
    'contractVersion','apply_production_lot_reforecast_v1',
    'reforecastEventId',v_event_id,
    'productionLotId',v_lot.id,
    'sourceEventId',v_source.id,
    'sourceEventType',v_source.event_type,
    'materialChange',coalesce((v_preview->>'materialChange')::boolean,false),
    'nextProjection',v_next,
    'movedDerivedCapacityRequirementCount',v_moved_requirements,
    'movedTentativeCapacityReservationCount',v_moved_tentative,
    'confirmedCapacityReservationRecommitCount',v_confirmed,
    'assignedBedPlacementRecommitCount',v_bed_recommit,
    'confirmedCommitmentsAutoMoved',false,
    'deduplicated',false
  );
end;
$function$;

create or replace function atlas.reforecast_from_production_lot_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.event_type in (
    'sown','germinated','germination_failed','transplanted','established','establishment_failed',
    'harvest_readiness_confirmed','harvest_not_ready','harvest_recorded',
    'water_care_completed','weed_care_completed','pinch_care_completed','support_care_completed','fertility_care_completed'
  ) then
    perform atlas.apply_production_lot_reforecast_v1(new.production_lot_id,new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists reforecast_from_production_lot_event on atlas.production_lot_events;
create trigger reforecast_from_production_lot_event
after insert on atlas.production_lot_events
for each row execute function atlas.reforecast_from_production_lot_event_v1();

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
  ) on conflict(idempotency_key) do nothing;
  return new;
end;
$function$;

drop trigger if exists bridge_production_harvest_lot_to_event on atlas.production_harvest_lots;
create trigger bridge_production_harvest_lot_to_event
after insert on atlas.production_harvest_lots
for each row execute function atlas.bridge_production_harvest_lot_to_event_v1();

revoke all on function atlas.production_lot_reforecast_preview_v1(uuid,uuid) from public;
revoke all on function atlas.apply_production_lot_reforecast_v1(uuid,uuid) from public;
grant execute on function atlas.production_lot_reforecast_preview_v1(uuid,uuid) to authenticated,service_role;
grant execute on function atlas.apply_production_lot_reforecast_v1(uuid,uuid) to authenticated,service_role;