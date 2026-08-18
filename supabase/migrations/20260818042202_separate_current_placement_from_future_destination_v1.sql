create or replace function atlas.ensure_crop_destination_resolution_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_existing atlas.tasks%rowtype;
  v_task atlas.tasks%rowtype;
  v_claim_count integer:=0;
  v_allocated numeric:=null;
  v_done_target numeric:=0;
  v_task_type text;
  v_title text;
  v_reason text;
  v_due date;
  v_role text;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id for update;
  if v_cycle.id is null then raise exception 'Crop cycle was not found.' using errcode='P0002'; end if;
  if coalesce(v_cycle.lifecycle_status,'active')<>'active' then
    return jsonb_build_object('cropCycleId',v_cycle.id,'state','terminal_no_resolution_needed','created',false);
  end if;

  select count(*) into v_claim_count from atlas.crop_destination_claims where crop_cycle_id=v_cycle.id and status='active';
  if v_claim_count>0 then
    return jsonb_build_object('cropCycleId',v_cycle.id,'state','claimed','created',false,'coverage',atlas.crop_destination_claim_coverage_v1(v_cycle.id));
  end if;

  select t.* into v_existing
  from atlas.task_crop_cycles tc join atlas.tasks t on t.id=tc.task_id
  where tc.crop_cycle_id=v_cycle.id and t.status in ('open','blocked')
    and t.task_type in ('spatial_destination_resolution','spatial_destination_reconciliation')
  order by t.created_at limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('cropCycleId',v_cycle.id,'state','resolution_path_open','taskId',v_existing.id,'created',false);
  end if;

  begin v_allocated:=nullif(v_cycle.metadata->>'allocated_seedlings','')::numeric; exception when others then v_allocated:=null; end;
  select coalesce(sum(coalesce(nullif(t.metadata->>'quantity','')::numeric,nullif(t.metadata->>'total_quantity','')::numeric,0)),0)
  into v_done_target
  from atlas.task_crop_cycles tc join atlas.tasks t on t.id=tc.task_id
  where tc.crop_cycle_id=v_cycle.id and t.status='done' and t.task_type='transplanting';

  if v_allocated is not null and v_allocated>0 and v_done_target>=v_allocated then
    v_task_type:='spatial_destination_reconciliation';
    v_title:='Inspect remaining transplant stock — '||coalesce(v_cycle.variety,v_cycle.crop_label);
    v_reason:='Older completed transplant cards account for the recorded allocated cohort, but task completion alone does not prove the source body is empty. Inspect remaining material before reclassifying or assigning more destinations.';
    v_role:='observes';
  else
    v_task_type:='spatial_destination_resolution';
    v_title:='Resolve transplant destination — '||coalesce(v_cycle.variety,v_cycle.crop_label);
    v_reason:='This living crop body is at a move-ready/hardening stage but has no canonical future destination claim. Current placement only describes where the body is now; assign a lawful next destination or explicitly decide that it should wait, be repaired, or terminate.';
    v_role:='prerequisite';
  end if;

  begin v_due:=nullif(v_cycle.metadata->>'planned_transplant_date','')::date; exception when others then v_due:=null; end;
  v_due:=greatest((now() at time zone 'America/Chicago')::date,coalesce(v_due,(now() at time zone 'America/Chicago')::date));

  insert into atlas.tasks(
    farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,
    action_key,operation_class,work_class,task_series_key,engine_instance_key,visibility_scope
  ) values (
    v_cycle.farm_id,v_title,v_task_type,'open','high',v_due,'crop_cycle_destination',v_cycle.id,v_reason,
    jsonb_build_object(
      'task_style',v_task_type,'source_crop_cycle_id',v_cycle.id,'crop_label',v_cycle.crop_label,'variety',v_cycle.variety,
      'source_cycle_state',v_cycle.cycle_state,'resolution_reason',v_reason,'repair_owner','farm_operations_management',
      'destination_claim_required',v_task_type='spatial_destination_resolution','physical_reconciliation_required',v_task_type='spatial_destination_reconciliation',
      'prior_done_transplant_target_quantity',v_done_target,'recorded_allocated_seedlings',v_allocated,
      'principal_escalation_created',false,'display_action',case when v_task_type='spatial_destination_resolution' then 'Resolve destination' else 'Inspect remaining stock' end,
      'display_subject',coalesce(v_cycle.variety,v_cycle.crop_label),'display_detail',v_reason
    ),
    case when v_task_type='spatial_destination_resolution' then 'resolve_destination' else 'inspect' end,
    'inspect_assess','standard','crop-cycle:'||v_cycle.id::text||':spatial-destination',
    'crop-spatial-destination:'||v_cycle.id::text,'management'
  ) returning * into v_task;

  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values(v_task.id,v_cycle.id,v_role,'confirmed','crop_spatial_destination_v1',jsonb_build_object('task_type',v_task_type))
  on conflict do nothing;

  return jsonb_build_object('cropCycleId',v_cycle.id,'state','resolution_path_open','taskId',v_task.id,'taskType',v_task_type,'created',true);
end;
$function$;

create or replace function atlas.crop_spatial_destination_reality_expression_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_zone_key text;
  v_claims jsonb:='[]'::jsonb;
  v_claim_count integer:=0;
  v_placements jsonb:='[]'::jsonb;
  v_resolution jsonb:=null;
  v_legacy jsonb:='[]'::jsonb;
  v_coverage jsonb;
  v_state text;
  v_destination_warrant boolean:=false;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle was not found.' using errcode='P0002'; end if;
  select * into v_object from atlas.growing_objects where id=v_cycle.object_id;
  select z.stable_key into v_zone_key from atlas.zones z where z.id=v_object.zone_id;
  v_coverage:=atlas.crop_destination_claim_coverage_v1(v_cycle.id);

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'claimId',c.id,'destinationObjectId',c.destination_object_id,'destinationObjectKey',go.stable_key,'destinationLabel',go.label,
           'destinationZoneKey',z.stable_key,'claimedQuantity',c.claimed_quantity,'unit',c.unit,'requiredBy',c.required_by,
           'windowStart',c.window_start,'windowEnd',c.window_end,'claimStrength',c.claim_strength,
           'displacementAuthority',c.displacement_authority,'protectionReason',c.protection_reason,'claimSource',c.claim_source,
           'sourceTaskId',c.source_task_id,'sourceEvidence',c.source_evidence
         )) order by c.required_by nulls last,go.label,c.id),'[]'::jsonb)
  into v_claim_count,v_claims
  from atlas.crop_destination_claims c
  join atlas.growing_objects go on go.id=c.destination_object_id
  left join atlas.zones z on z.id=go.zone_id
  where c.crop_cycle_id=v_cycle.id and c.status='active';

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'placementId',cp.id,'objectId',cp.object_id,'objectKey',go.stable_key,'objectLabel',go.label,
           'placementMode',cp.placement_mode,'placementLabel',cp.placement_label,'explicitPlantCount',cp.explicit_plant_count,
           'confidence',cp.confidence,'plantingClaimId',cp.planting_claim_id,
           'relationshipToCycleObject',case when cp.object_id=v_cycle.object_id then 'current_source_placement' else 'other_recorded_placement' end
         )) order by go.label,cp.id),'[]'::jsonb)
  into v_placements
  from atlas.crop_placements cp join atlas.growing_objects go on go.id=cp.object_id where cp.crop_cycle_id=v_cycle.id;

  select jsonb_strip_nulls(jsonb_build_object('taskId',t.id,'title',t.title,'taskType',t.task_type,'status',t.status,'dueDate',t.due_date,
         'visibilityScope',t.visibility_scope,'operationClass',t.operation_class,'reason',t.metadata->>'resolution_reason'))
  into v_resolution
  from atlas.task_crop_cycles tc join atlas.tasks t on t.id=tc.task_id
  where tc.crop_cycle_id=v_cycle.id and t.status in ('open','blocked')
    and t.task_type in ('spatial_destination_resolution','spatial_destination_reconciliation')
  order by t.due_date nulls last,t.created_at limit 1;

  if jsonb_typeof(coalesce(v_cycle.metadata,'{}'::jsonb)->'destination_object_ids')='array' then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('destinationObjectId',go.id,'destinationObjectKey',go.stable_key,
           'destinationLabel',go.label,'evidenceClass','legacy_metadata_candidate')) order by go.label),'[]'::jsonb)
    into v_legacy
    from jsonb_array_elements_text(v_cycle.metadata->'destination_object_ids') x(raw)
    join atlas.growing_objects go on go.farm_id=v_cycle.farm_id and go.id::text=x.raw;
  end if;

  if v_claim_count>0 and coalesce((v_coverage->>'spatialReleaseAllowed')::boolean,false) then v_state:='claimed'; v_destination_warrant:=true;
  elsif v_claim_count>0 then v_state:='claim_incomplete'; v_destination_warrant:=false;
  elsif v_resolution is not null then v_state:='resolution_path_open'; v_destination_warrant:=false;
  else v_state:='unresolved_without_path'; v_destination_warrant:=false;
  end if;

  return jsonb_build_object(
    'contractVersion','crop_spatial_destination_reality_expression_v1',
    'subject',jsonb_strip_nulls(jsonb_build_object('cropCycleId',v_cycle.id,'cropCycleKey',v_cycle.crop_cycle_key,'cropLabel',v_cycle.crop_label,
      'variety',v_cycle.variety,'cycleState',v_cycle.cycle_state,'lifecycleStatus',v_cycle.lifecycle_status)),
    'currentLocation',jsonb_strip_nulls(jsonb_build_object('objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,'zoneKey',v_zone_key,
      'recordedPlacements',v_placements)),
    'destination',jsonb_build_object('state',v_state,'destinationWarrantEstablished',v_destination_warrant,'coverage',v_coverage,
      'activeClaims',v_claims,'resolutionPath',v_resolution,'legacyCandidateDestinations',v_legacy),
    'releaseBoundary',jsonb_build_object('spatialReleaseAllowed',v_destination_warrant,
      'principle','Current placement describes present custody/location and never establishes a future destination. A future destination claim is distinct from occupancy. When moving quantity is known, active destination claims must cover it.'),
    'truthBoundary',jsonb_build_object('currentPlacementIsNotFutureDestination',true,'claimIsNotOccupancy',true,'claimIsNotDestinationReadiness',true,
      'metadataCandidateIsNotCanonicalClaim',true,'noDestinationNoConfidentRelease',true,'resolutionPathDoesNotEqualRelease',true)
  );
end;
$function$;