alter table atlas.flower_harvest_bucket_observations
  alter column more_available drop not null;

alter table atlas.flower_harvest_bucket_observations
  add column more_availability text generated always as (
    case
      when more_available is true then 'yes'::text
      when more_available is false then 'no'::text
      else 'unsure'::text
    end
  ) stored;

alter table atlas.crop_harvest_events
  drop constraint crop_harvest_events_outcome_check;

alter table atlas.crop_harvest_events
  add constraint crop_harvest_events_outcome_check
  check (outcome = any (array[
    'not_ready'::text,
    'beginning'::text,
    'harvestable'::text,
    'declining'::text,
    'finished'::text,
    'problem_or_uncertain'::text,
    'harvested_more'::text,
    'harvested_finished'::text,
    'harvested_uncertain'::text
  ]));

alter function atlas.production_lot_reforecast_preview_v1(uuid,uuid)
  rename to production_lot_reforecast_preview_pre_or4_v1;

create function atlas.production_lot_reforecast_preview_v1(
  p_production_lot_id uuid,
  p_source_event_id uuid default null::uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_preview jsonb;
  v_quantity jsonb;
  v_bucket_event_count integer := 0;
  v_bucket_floor numeric := 0;
  v_bucket_lower_bound boolean := false;
  v_has_stem_evidence boolean := false;
begin
  v_preview := atlas.production_lot_reforecast_preview_pre_or4_v1(
    p_production_lot_id,
    p_source_event_id
  );

  select
    count(*)::integer,
    coalesce(sum(e.quantity),0),
    bool_or(coalesce(e.metadata->>'quantityExactness','')='lower_bound')
  into v_bucket_event_count,v_bucket_floor,v_bucket_lower_bound
  from atlas.production_lot_events e
  where e.production_lot_id=p_production_lot_id
    and e.event_type='harvest_recorded'
    and coalesce(e.metadata->>'harvestEvidenceKind','')='flower_bucket_observation';

  select exists(
    select 1
    from atlas.production_lot_events e
    where e.production_lot_id=p_production_lot_id
      and e.event_type='harvest_recorded'
      and e.metadata ? 'marketable_stems'
  ) into v_has_stem_evidence;

  if v_bucket_event_count>0 then
    v_quantity := coalesce(v_preview->'quantityEvidence','{}'::jsonb);
    if not v_has_stem_evidence then
      v_quantity := v_quantity
        - 'harvestedMarketableStems'
        - 'harvestedSecondsStems'
        - 'harvestedDiscardedStems';
    end if;
    v_quantity := v_quantity || jsonb_build_object(
      'flowerHarvestEvidenceCount',v_bucket_event_count,
      'flowerHarvestBucketEquivalentObservedFloor',v_bucket_floor,
      'flowerHarvestUnit','bucket_equivalent',
      'flowerHarvestEvidencePrecision',case when v_bucket_lower_bound then 'lower_bound' else 'coarse_physical' end
    );
    v_preview := jsonb_set(v_preview,'{quantityEvidence}',v_quantity,true);
    v_preview := jsonb_set(
      v_preview,
      '{nextProjection,harvestSource}',
      to_jsonb(case when v_has_stem_evidence then 'mixed_actual_harvest_evidence' else 'actual_flower_bucket_harvest' end::text),
      true
    );
  end if;

  v_preview := jsonb_set(
    v_preview,
    '{contractVersion}',
    to_jsonb('production_lot_reforecast_preview_v3'::text),
    true
  );
  return v_preview;
end;
$function$;

revoke all on function atlas.production_lot_reforecast_preview_v1(uuid,uuid) from public;
revoke all on function atlas.production_lot_reforecast_preview_v1(uuid,uuid) from anon;
grant execute on function atlas.production_lot_reforecast_preview_v1(uuid,uuid) to authenticated,service_role;

create function atlas.bridge_flower_harvest_to_production_v1(p_crop_harvest_event_id uuid)
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
begin
  select * into v_event
  from atlas.crop_harvest_events
  where id=p_crop_harvest_event_id;

  if v_event.id is null then
    raise exception 'Crop harvest event not found.' using errcode='P0002';
  end if;

  if coalesce(v_event.metadata->>'physicalOutputMode','')<>'bucket_scale' then
    return jsonb_build_object(
      'state','not_flower_bucket_evidence',
      'cropHarvestEventId',v_event.id
    );
  end if;

  select count(distinct link.production_lot_id)::integer,
         min(link.production_lot_id::text)::uuid
  into v_lot_count,v_lot_id
  from atlas.production_lot_crop_cycles link
  where link.crop_cycle_id=v_event.crop_cycle_id
    and link.confidence='confirmed';

  if v_lot_count<>1 then
    v_reason := case when v_lot_count=0 then 'no_confirmed_production_lot_lineage' else 'ambiguous_confirmed_production_lot_lineage' end;
    insert into atlas.workflow_events(
      farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload
    ) values (
      v_event.farm_id,
      'or4:harvest-production-reconciliation:'||v_event.id::text,
      'crop_harvest_event',
      v_event.id,
      v_event.id::text,
      'production_reconciliation_required',
      v_event.observed_date,
      jsonb_build_object(
        'contractVersion','or4_flower_harvest_result_state_transition_v1',
        'reason',v_reason,
        'confirmedProductionLotCount',v_lot_count,
        'cropCycleId',v_event.crop_cycle_id,
        'taskId',v_event.task_id,
        'principle','Harvest completion remains true; Production lineage must not be guessed.'
      )
    ) on conflict (farm_id,event_key) do nothing;
    return jsonb_build_object(
      'state','reconciliation_required',
      'reason',v_reason,
      'confirmedProductionLotCount',v_lot_count,
      'cropHarvestEventId',v_event.id
    );
  end if;

  begin
    v_quantity := nullif(v_event.metadata->>'bucketEquivalentFloor','')::numeric;
  exception when invalid_text_representation then
    v_quantity := null;
  end;
  if v_quantity is null then
    v_reason := 'flower_bucket_quantity_missing';
    insert into atlas.workflow_events(
      farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload
    ) values (
      v_event.farm_id,
      'or4:harvest-production-reconciliation:'||v_event.id::text,
      'crop_harvest_event',v_event.id,v_event.id::text,
      'production_reconciliation_required',v_event.observed_date,
      jsonb_build_object(
        'contractVersion','or4_flower_harvest_result_state_transition_v1',
        'reason',v_reason,'productionLotId',v_lot_id,'cropCycleId',v_event.crop_cycle_id,
        'principle','Harvest completion remains true; missing measured output is reconciliation debt.'
      )
    ) on conflict (farm_id,event_key) do nothing;
    return jsonb_build_object('state','reconciliation_required','reason',v_reason,'cropHarvestEventId',v_event.id);
  end if;

  v_exactness := case
    when coalesce(v_event.metadata->>'bucketBand','')='more_than_one' then 'lower_bound'
    else 'coarse_physical'
  end;
  v_more_availability := case
    when v_event.more_available is true then 'yes'
    when v_event.more_available is false then 'no'
    else 'unsure'
  end;
  select object_id into v_object_id from atlas.crop_cycles where id=v_event.crop_cycle_id;

  insert into atlas.production_lot_events(
    farm_id,production_lot_id,event_type,event_date,quantity,unit,task_id,crop_cycle_id,object_id,
    note,source,idempotency_key,metadata
  ) values (
    v_event.farm_id,v_lot_id,'harvest_recorded',v_event.observed_date,v_quantity,'bucket_equivalent',
    v_event.task_id,v_event.crop_cycle_id,v_object_id,v_event.note,
    'flower_harvest_or4','or4:crop-harvest:'||v_event.id::text,
    jsonb_build_object(
      'harvestEvidenceKind','flower_bucket_observation',
      'quantityExactness',v_exactness,
      'bucketBand',v_event.metadata->>'bucketBand',
      'bucketEquivalentFloor',v_quantity,
      'moreAvailability',v_more_availability,
      'sourceCropHarvestEventId',v_event.id,
      'sourceFlowerHarvestObservationId',v_event.metadata->>'flowerHarvestObservationId',
      'sourceFlowerHarvestBatchId',v_event.metadata->>'flowerHarvestBatchId',
      'harvest_action',case when v_more_availability='no' then 'complete' when v_more_availability='yes' then 'continue' else 'uncertain' end,
      'truthBoundary','actual_harvest_output_evidence'
    )
  ) on conflict (farm_id,idempotency_key) do update
    set idempotency_key=excluded.idempotency_key
  returning id into v_prod_event_id;

  return jsonb_build_object(
    'state','production_evidence_recorded',
    'cropHarvestEventId',v_event.id,
    'productionLotId',v_lot_id,
    'productionLotEventId',v_prod_event_id,
    'quantity',v_quantity,
    'unit','bucket_equivalent',
    'quantityExactness',v_exactness,
    'moreAvailability',v_more_availability
  );
exception when others then
  begin
    insert into atlas.workflow_events(
      farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload
    ) values (
      v_event.farm_id,
      'or4:harvest-production-reconciliation:'||v_event.id::text,
      'crop_harvest_event',v_event.id,v_event.id::text,
      'production_reconciliation_required',coalesce(v_event.observed_date,(now() at time zone 'America/Chicago')::date),
      jsonb_build_object(
        'contractVersion','or4_flower_harvest_result_state_transition_v1',
        'reason','production_bridge_failed',
        'error',sqlerrm,
        'cropCycleId',v_event.crop_cycle_id,
        'taskId',v_event.task_id,
        'principle','Harvest completion remains true; downstream Production reconciliation failed and must be repaired separately.'
      )
    ) on conflict (farm_id,event_key) do nothing;
  exception when others then
    null;
  end;
  return jsonb_build_object(
    'state','reconciliation_required',
    'reason','production_bridge_failed',
    'cropHarvestEventId',p_crop_harvest_event_id
  );
end;
$function$;

revoke all on function atlas.bridge_flower_harvest_to_production_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.bridge_flower_harvest_to_production_v1(uuid) to service_role;

create function atlas.bridge_flower_harvest_to_production_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.event_kind='cut' and coalesce(new.metadata->>'physicalOutputMode','')='bucket_scale' then
    perform atlas.bridge_flower_harvest_to_production_v1(new.id);
  end if;
  return new;
end;
$function$;

revoke all on function atlas.bridge_flower_harvest_to_production_trigger_v1() from public,anon,authenticated;
grant execute on function atlas.bridge_flower_harvest_to_production_trigger_v1() to service_role;

create trigger crop_harvest_events_bridge_flower_production_or4_v1
after insert on atlas.crop_harvest_events
for each row execute function atlas.bridge_flower_harvest_to_production_trigger_v1();

create function atlas.record_flower_harvest_output_core_v2(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_bucket_band text,
  p_more_availability text,
  p_note text,
  p_idempotency_key text,
  p_operator_mode boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_band text := lower(btrim(coalesce(p_bucket_band,'')));
  v_more text := lower(btrim(coalesce(p_more_availability,'')));
  v_more_bool boolean;
  v_floor numeric(5,2);
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_existing atlas.flower_harvest_bucket_observations%rowtype;
  v_existing_event_id uuid;
  v_batch_id uuid;
  v_observation atlas.flower_harvest_bucket_observations%rowtype;
  v_event atlas.crop_harvest_events%rowtype;
  v_transition jsonb;
  v_enrollment jsonb;
  v_production jsonb;
begin
  if v_band not in ('quarter','half','three_quarters','one','more_than_one') then
    raise exception 'Choose a supported bucket amount.' using errcode='22023';
  end if;
  v_floor := case v_band
    when 'quarter' then 0.25
    when 'half' then 0.50
    when 'three_quarters' then 0.75
    when 'one' then 1.00
    when 'more_than_one' then 1.00
  end;
  if v_more not in ('yes','no','unsure') then
    raise exception 'Record whether more remains to harvest: yes, no, or unsure.' using errcode='22023';
  end if;
  v_more_bool := case when v_more='yes' then true when v_more='no' then false else null end;
  if v_key is null then raise exception 'Flower harvest idempotency key is required.' using errcode='22023'; end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Harvest task not found.' using errcode='P0002'; end if;

  select * into v_existing
  from atlas.flower_harvest_bucket_observations
  where farm_id=v_task.farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    select id into v_existing_event_id
    from atlas.crop_harvest_events
    where farm_id=v_task.farm_id and idempotency_key=v_key;
    if v_existing_event_id is not null then
      v_production:=atlas.bridge_flower_harvest_to_production_v1(v_existing_event_id);
    end if;
    return jsonb_build_object(
      'observationId',v_existing.id,
      'batchId',v_existing.batch_id,
      'eventId',v_existing_event_id,
      'taskId',v_existing.task_id,
      'cropCycleId',v_existing.crop_cycle_id,
      'bucketBand',v_existing.bucket_band,
      'bucketEquivalentFloor',v_existing.bucket_equivalent_floor,
      'moreAvailable',v_existing.more_available,
      'moreAvailability',v_existing.more_availability,
      'productionReconciliation',v_production,
      'deduplicated',true
    );
  end if;

  if v_task.status not in ('open','blocked') or v_task.task_type<>'crop_harvest' then
    raise exception 'Task is not an open crop harvest.' using errcode='22023';
  end if;
  if p_effective_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot record harvest.' using errcode='42501';
  end if;

  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id;
  if v_membership.id is null or not v_membership.active or v_membership.farm_id is distinct from v_task.farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if p_effective_role='farm_hand' and (
    v_task.visibility_scope<>'assigned_worker'
    or v_task.assigned_membership_id is distinct from p_effective_membership_id
  ) then
    raise exception 'Harvest task is not assigned to this worker.' using errcode='42501';
  end if;

  select cc.* into v_cycle
  from atlas.task_crop_cycles tcc
  join atlas.crop_cycles cc on cc.id=tcc.crop_cycle_id
  where tcc.task_id=v_task.id
  order by tcc.created_at
  limit 1;
  if v_cycle.id is null then raise exception 'Harvest task has no linked crop cycle.' using errcode='22023'; end if;
  if v_cycle.farm_id is distinct from v_task.farm_id then raise exception 'Harvest crop cycle is outside the task farm.' using errcode='22023'; end if;

  insert into atlas.flower_harvest_batches(
    farm_id,harvest_date,recorded_by_membership_id,batch_key,metadata,created_by_user_id
  ) values (
    v_task.farm_id,v_today,p_effective_membership_id,
    'flower-harvest:'||p_effective_membership_id::text||':'||v_today::text,
    jsonb_build_object('physicalOutputMode','bucket_scale','precision','coarse_physical'),auth.uid()
  )
  on conflict (farm_id,batch_key) do update set updated_at=now()
  returning id into v_batch_id;

  insert into atlas.flower_harvest_bucket_observations(
    farm_id,batch_id,crop_cycle_id,task_id,recorded_by_membership_id,observed_date,
    bucket_band,bucket_equivalent_floor,more_available,note,idempotency_key,created_by_user_id,metadata
  ) values (
    v_task.farm_id,v_batch_id,v_cycle.id,v_task.id,p_effective_membership_id,v_today,
    v_band,v_floor,v_more_bool,nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),
    jsonb_build_object(
      'physicalOutputMode','bucket_scale','precision','coarse_physical','moreAvailability',v_more,
      'operatorMode',p_operator_mode,'effectiveMembershipId',p_effective_membership_id
    )
  ) returning * into v_observation;

  insert into atlas.crop_harvest_events(
    farm_id,crop_cycle_id,task_id,event_kind,outcome,observed_date,
    more_available,note,idempotency_key,created_by_user_id,metadata
  ) values (
    v_task.farm_id,v_cycle.id,v_task.id,'cut',
    case when v_more='yes' then 'harvested_more' when v_more='no' then 'harvested_finished' else 'harvested_uncertain' end,
    v_today,v_more_bool,nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),
    jsonb_build_object(
      'physicalOutputMode','bucket_scale','precision','coarse_physical',
      'flowerHarvestBatchId',v_batch_id,'flowerHarvestObservationId',v_observation.id,
      'bucketBand',v_band,'bucketEquivalentFloor',v_floor,'moreAvailability',v_more,
      'operatorMode',p_operator_mode,'effectiveMembershipId',p_effective_membership_id
    )
  ) returning * into v_event;

  v_transition := atlas.record_task_transition_v1_internal(
    v_task.id,'done','flower-harvest:'||v_observation.id::text,null,p_note,null,'harvest','crop_harvest',
    jsonb_build_object(
      'crop_cycle_id',v_cycle.id,'crop_harvest_event_id',v_event.id,
      'flower_harvest_batch_id',v_batch_id,'flower_harvest_observation_id',v_observation.id,
      'bucket_band',v_band,'bucket_equivalent_floor',v_floor,
      'more_available',v_more_bool,'more_availability',v_more,'physical_output_mode','bucket_scale'
    ),null
  );

  update atlas.crop_cycles
  set harvest_started_date=coalesce(harvest_started_date,v_today),
      last_harvest_date=v_today,
      cycle_state=case when v_more='no' then 'finished_harvest' else 'harvest_watch' end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'last_harvest_event_id',v_event.id,'last_flower_harvest_batch_id',v_batch_id,
        'last_flower_harvest_observation_id',v_observation.id,'last_flower_harvest_bucket_band',v_band,
        'last_flower_harvest_bucket_equivalent_floor',v_floor,'physical_output_mode','bucket_scale',
        'more_available',v_more_bool,'more_availability',v_more
      ),updated_at=now()
  where id=v_cycle.id;

  update atlas.crop_harvest_availability
  set status=case when v_more='no' then 'finished' else 'watching' end,
      estimated_quantity=null,unit=null,observed_date=v_today,source_event_id=v_event.id,
      current_harvest_task_id=null,current_harvest_occurrence_id=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'lastCutEventId',v_event.id,'lastFlowerHarvestBatchId',v_batch_id,
        'lastFlowerHarvestObservationId',v_observation.id,'lastFlowerHarvestBucketBand',v_band,
        'physicalOutputMode','bucket_scale','moreAvailable',v_more_bool,'moreAvailability',v_more
      ),updated_at=now()
  where crop_cycle_id=v_cycle.id;

  if v_more<>'no' then
    v_enrollment := atlas.enroll_harvest_watch_v1(v_cycle.id,null,v_today+1);
  else
    update atlas.rhythm_state
    set state='paused',state_reason=jsonb_build_object('source','flower_harvest_finished','eventId',v_event.id,'observationId',v_observation.id),
        current_task_id=null,current_occurrence_id=null,updated_at=now()
    where farm_id=v_cycle.farm_id and rhythm_key='harvest_watch' and subject_kind='crop_cycle' and subject_id=v_cycle.id;
  end if;

  v_production := atlas.bridge_flower_harvest_to_production_v1(v_event.id);

  return jsonb_build_object(
    'observationId',v_observation.id,'batchId',v_batch_id,'eventId',v_event.id,'taskId',v_task.id,
    'cropCycleId',v_cycle.id,'bucketBand',v_band,'bucketEquivalentFloor',v_floor,
    'moreAvailable',v_more_bool,'moreAvailability',v_more,'nextWatch',v_enrollment,
    'productionReconciliation',v_production,'transition',v_transition,'deduplicated',false
  );
end;
$function$;

revoke all on function atlas.record_flower_harvest_output_core_v2(uuid,uuid,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.record_flower_harvest_output_core_v2(uuid,uuid,text,text,text,text,text,boolean) to service_role;

create function atlas.record_flower_harvest_output_for_member_v2(
  p_farm_id uuid,
  p_task_id uuid,
  p_bucket_band text,
  p_more_availability text,
  p_note text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_role text;
  v_membership uuid;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  v_membership := atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  return atlas.record_flower_harvest_output_core_v2(
    p_task_id,v_membership,v_role,p_bucket_band,p_more_availability,p_note,p_idempotency_key,false
  );
end;
$function$;

revoke all on function atlas.record_flower_harvest_output_for_member_v2(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function atlas.record_flower_harvest_output_for_member_v2(uuid,uuid,text,text,text,text) to authenticated,service_role;

create function atlas.owner_operator_record_flower_harvest_output_v2(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_bucket_band text,
  p_more_availability text,
  p_note text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_context jsonb;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_flower_harvest_output_core_v2(
    p_task_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',
    p_bucket_band,p_more_availability,p_note,p_idempotency_key,true
  );
end;
$function$;

revoke all on function atlas.owner_operator_record_flower_harvest_output_v2(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function atlas.owner_operator_record_flower_harvest_output_v2(uuid,uuid,text,text,text,text) to service_role;

alter function atlas.worker_state_transition_card_v2(uuid,uuid,uuid,date)
  rename to worker_state_transition_card_pre_or4_v2;

create function atlas.worker_state_transition_card_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_card jsonb;
  v_task atlas.tasks%rowtype;
  v_authorized boolean := false;
begin
  v_card := atlas.worker_state_transition_card_pre_or4_v2(
    p_farm_id,p_membership_id,p_task_id,p_service_date
  );
  select * into v_task from atlas.tasks where id=p_task_id and farm_id=p_farm_id;
  v_authorized := coalesce(v_card#>>'{transition,state}','')='authorized_for_routed_day';

  if v_task.id is not null and v_task.task_type='crop_harvest' and v_authorized then
    v_card := jsonb_set(
      v_card,
      '{resultReturn}',
      jsonb_build_object(
        'state','structured_result_v1_available',
        'contractVersion','record_flower_harvest_output_for_member_v2',
        'domainAdapter','flower_harvest_output_or4_v1',
        'choices',jsonb_build_array('yes','no','unsure'),
        'requiredFields',jsonb_build_array('bucketBand','moreAvailability','idempotencyKey'),
        'bucketBandChoices',jsonb_build_array('quarter','half','three_quarters','one','more_than_one'),
        'optionalFields',jsonb_build_array('note'),
        'doneInvariant','Harvest completion records measured physical output against the canonical crop cycle. Harvested physical output is not Ready inventory.',
        'observationInvariant','The worker reports only the bucket-scale observation and whether more harvestable material remains: yes, no, or unsure. Atlas preserves uncertainty rather than converting it to yes or no.',
        'productionInvariant','Production learns from Harvest only through confirmed Production-to-Crop lineage; missing or ambiguous lineage becomes reconciliation debt without undoing Harvest completion.'
      ),
      true
    );
  end if;
  return v_card;
end;
$function$;

revoke all on function atlas.worker_state_transition_card_v2(uuid,uuid,uuid,date) from public,anon;
grant execute on function atlas.worker_state_transition_card_v2(uuid,uuid,uuid,date) to authenticated,service_role;
