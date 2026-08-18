create or replace function atlas.crop_destination_claim_coverage_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_required numeric:=null;
  v_required_source text:=null;
  v_claim_count integer:=0;
  v_quantified_count integer:=0;
  v_claimed numeric:=0;
  v_state text;
  v_release boolean:=false;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle was not found.' using errcode='P0002'; end if;

  begin v_required:=nullif(v_cycle.metadata->>'transplant_ready_seedlings','')::numeric; exception when others then v_required:=null; end;
  if v_required is not null then v_required_source:='transplant_ready_seedlings'; end if;
  if v_required is null then
    begin v_required:=nullif(v_cycle.metadata->>'owner_assumed_transplant_count','')::numeric; exception when others then v_required:=null; end;
    if v_required is not null then v_required_source:='owner_assumed_transplant_count'; end if;
  end if;
  if v_required is null then
    begin v_required:=nullif(v_cycle.metadata->>'last_seedling_count','')::numeric; exception when others then v_required:=null; end;
    if v_required is not null then v_required_source:='last_seedling_count'; end if;
  end if;
  if v_required is null then
    begin v_required:=nullif(v_cycle.metadata->>'allocated_seedlings','')::numeric; exception when others then v_required:=null; end;
    if v_required is not null then v_required_source:='allocated_seedlings'; end if;
  end if;
  if v_required is null and v_cycle.coverage_amount is not null and lower(coalesce(v_cycle.coverage_unit,'')) in ('plant','plants','seedling','seedlings') then
    v_required:=v_cycle.coverage_amount; v_required_source:='crop_cycle_coverage';
  end if;

  select count(*)::integer,
         count(*) filter(where claimed_quantity is not null and lower(coalesce(unit,'')) in ('plant','plants','seedling','seedlings'))::integer,
         coalesce(sum(claimed_quantity) filter(where lower(coalesce(unit,'')) in ('plant','plants','seedling','seedlings')),0)
  into v_claim_count,v_quantified_count,v_claimed
  from atlas.crop_destination_claims
  where crop_cycle_id=v_cycle.id and status='active';

  if v_claim_count=0 then
    v_state:='missing'; v_release:=false;
  elsif v_required is null then
    v_state:='destination_established_quantity_unresolved'; v_release:=true;
  elsif v_quantified_count<v_claim_count then
    v_state:='quantity_unresolved'; v_release:=false;
  elsif v_claimed+0.0001 < v_required then
    v_state:='partial'; v_release:=false;
  else
    v_state:='complete'; v_release:=true;
  end if;

  return jsonb_build_object(
    'contractVersion','crop_destination_claim_coverage_v1','cropCycleId',v_cycle.id,
    'claimCount',v_claim_count,'quantifiedClaimCount',v_quantified_count,
    'requiredMoveQuantity',v_required,'requiredQuantityUnit',case when v_required is null then null else 'plants' end,
    'requiredQuantitySource',v_required_source,'claimedMoveQuantity',v_claimed,'coverageState',v_state,
    'spatialReleaseAllowed',v_release,
    'principle','A lawful destination claim and claim quantity are distinct. When the moving cohort quantity is known, quantified destination claims must cover that cohort before spatial release is confident.'
  );
end;
$function$;
revoke all on function atlas.crop_destination_claim_coverage_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.crop_destination_claim_coverage_v1(uuid) to service_role;

create or replace function atlas.record_crop_destination_claim_v1(
  p_crop_cycle_id uuid,
  p_destination_object_id uuid,
  p_claimed_quantity numeric,
  p_unit text,
  p_required_by date,
  p_claim_strength text,
  p_displacement_authority text,
  p_protection_reason text,
  p_source_task_id uuid,
  p_claim_source text,
  p_source_evidence jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_existing atlas.crop_destination_claims%rowtype;
  v_claim atlas.crop_destination_claims%rowtype;
begin
  if p_crop_cycle_id is null or p_destination_object_id is null or nullif(btrim(coalesce(p_claim_source,'')),'') is null or nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception 'Crop cycle, destination, claim source, and idempotency key are required.' using errcode='22023';
  end if;
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle was not found.' using errcode='P0002'; end if;
  select * into v_existing from atlas.crop_destination_claims where farm_id=v_cycle.farm_id and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('claimId',v_existing.id,'cropCycleId',v_existing.crop_cycle_id,'destinationObjectId',v_existing.destination_object_id,'deduplicated',true,'coverage',atlas.crop_destination_claim_coverage_v1(v_existing.crop_cycle_id));
  end if;
  insert into atlas.crop_destination_claims(
    farm_id,crop_cycle_id,destination_object_id,source_task_id,claim_source,claimed_quantity,unit,required_by,
    claim_strength,displacement_authority,protection_reason,source_evidence,idempotency_key,metadata
  ) values (
    v_cycle.farm_id,v_cycle.id,p_destination_object_id,p_source_task_id,btrim(p_claim_source),p_claimed_quantity,nullif(btrim(coalesce(p_unit,'')),''),p_required_by,
    coalesce(nullif(btrim(p_claim_strength),''),'planned'),coalesce(nullif(btrim(p_displacement_authority),''),'farm_operations'),
    nullif(btrim(coalesce(p_protection_reason,'')),''),coalesce(p_source_evidence,'{}'::jsonb),p_idempotency_key,
    jsonb_build_object('truth_boundary','crop_preplacement_destination_claim')
  ) returning * into v_claim;
  return jsonb_build_object('claimId',v_claim.id,'cropCycleId',v_claim.crop_cycle_id,'destinationObjectId',v_claim.destination_object_id,'deduplicated',false,'coverage',atlas.crop_destination_claim_coverage_v1(v_claim.crop_cycle_id));
end;
$function$;
revoke all on function atlas.record_crop_destination_claim_v1(uuid,uuid,numeric,text,date,text,text,text,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function atlas.record_crop_destination_claim_v1(uuid,uuid,numeric,text,date,text,text,text,uuid,text,jsonb,text) to service_role;

create or replace function atlas.ensure_task_destination_resolution_v1(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_readiness jsonb;
  v_existing atlas.tasks%rowtype;
  v_resolution atlas.tasks%rowtype;
  v_due date;
  v_subject text;
  v_count integer:=0;
begin
  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Task was not found.' using errcode='P0002'; end if;
  v_readiness:=atlas.task_execution_destination_readiness_v1(v_task.id);
  if coalesce((v_readiness->>'ready')::boolean,false) then
    return jsonb_build_object('sourceTaskId',v_task.id,'state','destination_ready','created',false);
  end if;
  if lower(coalesce(v_task.task_type,'')) not in ('transplanting','production_transplant') then
    return jsonb_build_object('sourceTaskId',v_task.id,'state','not_applicable','created',false);
  end if;

  select t.* into v_existing from atlas.tasks t
  where t.generated_from='task_destination_resolution' and t.generated_from_id=v_task.id and t.status in ('open','blocked')
  order by t.created_at limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('sourceTaskId',v_task.id,'state','resolution_path_open','resolutionTaskId',v_existing.id,'created',false);
  end if;

  v_due:=greatest((now() at time zone 'America/Chicago')::date,coalesce(v_task.due_date,(now() at time zone 'America/Chicago')::date));
  v_subject:=coalesce(nullif(v_task.metadata->>'display_subject',''),v_task.title);
  insert into atlas.tasks(
    farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,
    action_key,operation_class,work_class,task_series_key,engine_instance_key,visibility_scope
  ) values (
    v_task.farm_id,'Resolve destination — '||v_subject,'spatial_destination_resolution','open','high',v_due,
    'task_destination_resolution',v_task.id,
    'Establish a canonical destination claim for the crop body or explicitly keep the move blocked. Do not release transplant execution from a text placeholder.',
    jsonb_build_object('task_style','spatial_destination_resolution','source_task_id',v_task.id,'source_task_title',v_task.title,
      'resolution_reason',v_readiness->>'reason','repair_owner','farm_operations_management','principal_escalation_created',false,
      'display_action','Resolve destination','display_subject',v_subject,'display_detail',coalesce(v_readiness->>'reason','Canonical destination required.')),
    'resolve_destination','inspect_assess','standard','task:'||v_task.id::text||':spatial-destination','task-spatial-destination:'||v_task.id::text,'management'
  ) returning * into v_resolution;

  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  select v_resolution.id,cc.id,'prerequisite','confirmed','task_destination_resolution_v1',jsonb_build_object('source_task_id',v_task.id)
  from atlas.crop_cycles cc
  where cc.farm_id=v_task.farm_id and cc.id in (
    select tc.crop_cycle_id from atlas.task_crop_cycles tc where tc.task_id=v_task.id
    union
    select x.raw::uuid from jsonb_array_elements_text(case when jsonb_typeof(v_task.metadata->'crop_cycle_ids')='array' then v_task.metadata->'crop_cycle_ids' else '[]'::jsonb end) x(raw)
      where x.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union
    select nullif(v_task.metadata->>'source_crop_cycle_id','')::uuid where coalesce(v_task.metadata->>'source_crop_cycle_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  on conflict do nothing;
  get diagnostics v_count=row_count;

  return jsonb_build_object('sourceTaskId',v_task.id,'state','resolution_path_open','resolutionTaskId',v_resolution.id,'linkedCropCycleCount',v_count,'created',true);
end;
$function$;
revoke all on function atlas.ensure_task_destination_resolution_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.ensure_task_destination_resolution_v1(uuid) to service_role;

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
  v_placement_count integer:=0;
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

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'placementId',cp.id,'objectId',cp.object_id,'objectKey',go.stable_key,'objectLabel',go.label,
           'placementMode',cp.placement_mode,'placementLabel',cp.placement_label,'explicitPlantCount',cp.explicit_plant_count,
           'confidence',cp.confidence,'plantingClaimId',cp.planting_claim_id
         )) order by go.label,cp.id),'[]'::jsonb)
  into v_placement_count,v_placements
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

  if v_placement_count>0 then v_state:='placed'; v_destination_warrant:=true;
  elsif v_claim_count>0 and coalesce((v_coverage->>'spatialReleaseAllowed')::boolean,false) then v_state:='claimed'; v_destination_warrant:=true;
  elsif v_claim_count>0 then v_state:='claim_incomplete'; v_destination_warrant:=false;
  elsif v_resolution is not null then v_state:='resolution_path_open'; v_destination_warrant:=false;
  else v_state:='unresolved_without_path'; v_destination_warrant:=false;
  end if;

  return jsonb_build_object(
    'contractVersion','crop_spatial_destination_reality_expression_v1',
    'subject',jsonb_strip_nulls(jsonb_build_object('cropCycleId',v_cycle.id,'cropCycleKey',v_cycle.crop_cycle_key,'cropLabel',v_cycle.crop_label,
      'variety',v_cycle.variety,'cycleState',v_cycle.cycle_state,'lifecycleStatus',v_cycle.lifecycle_status)),
    'currentLocation',jsonb_strip_nulls(jsonb_build_object('objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,'zoneKey',v_zone_key)),
    'destination',jsonb_build_object('state',v_state,'destinationWarrantEstablished',v_destination_warrant,'coverage',v_coverage,
      'activeClaims',v_claims,'currentPlacements',v_placements,'resolutionPath',v_resolution,'legacyCandidateDestinations',v_legacy),
    'releaseBoundary',jsonb_build_object('spatialReleaseAllowed',v_destination_warrant,
      'principle','A future destination claim is not current occupancy. When moving quantity is known, active destination claims must cover it. Metadata-only destinations are evidence candidates, not canonical claims.'),
    'truthBoundary',jsonb_build_object('claimIsNotOccupancy',true,'claimIsNotDestinationReadiness',true,'metadataCandidateIsNotCanonicalClaim',true,
      'noDestinationNoConfidentRelease',true,'resolutionPathDoesNotEqualRelease',true)
  );
end;
$function$;

create or replace function atlas.task_execution_destination_readiness_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_zone_key text; v_operation text; v_type text; v_destination_id uuid; v_destination_exists boolean:=false; v_destination_text text;
  v_state text; v_ready boolean; v_reason text; v_source text; v_gate atlas.production_transplant_gates%rowtype;
  v_cycle_count integer:=0; v_ready_cycle_count integer:=0; v_resolution_count integer:=0; v_claims jsonb:='[]'::jsonb;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  select z.stable_key into v_zone_key from atlas.zones z where z.id=v_task.zone_id;
  v_operation:=lower(coalesce(v_task.operation_class,'')); v_type:=lower(coalesce(v_task.task_type,''));
  v_destination_text:=nullif(btrim(coalesce(v_task.metadata->>'transplant_destination',v_task.metadata->>'destination_label',v_task.metadata->>'execution_destination','')),'');
  begin v_destination_id:=nullif(coalesce(v_task.metadata->>'destination_object_id',v_task.metadata->>'transplant_destination_object_id',v_task.metadata->>'target_object_id'),'')::uuid; exception when others then v_destination_id:=null; end;
  if v_destination_id is not null then select exists(select 1 from atlas.growing_objects go where go.id=v_destination_id and go.farm_id=v_task.farm_id) into v_destination_exists; end if;

  if v_type='production_transplant' then
    select * into v_gate from atlas.production_transplant_gates where id=v_task.generated_from_id and farm_id=v_task.farm_id;
    if v_gate.id is not null and v_gate.gate_status='ready' then v_state:='ready'; v_ready:=true; v_source:='production_transplant_gate';
    else v_state:='destination_required'; v_ready:=false; v_source:='production_transplant_gate'; v_reason:=coalesce(v_gate.blocker_text,'Production transplant requires a ready native transplant gate with assigned and prepared bed capacity.'); end if;
  elsif v_type<>'transplanting' then v_state:='not_applicable'; v_ready:=true; v_source:='task_type';
  elsif v_operation not in ('establish_aboveground','establish_belowground','divide_reestablish_belowground') then v_state:='not_applicable'; v_ready:=true; v_source:='operation_class';
  elsif v_destination_exists then v_state:='ready'; v_ready:=true; v_source:='destination_object';
  else
    with cycle_ids as (
      select tc.crop_cycle_id id from atlas.task_crop_cycles tc where tc.task_id=v_task.id
      union select x.raw::uuid from jsonb_array_elements_text(case when jsonb_typeof(v_task.metadata->'crop_cycle_ids')='array' then v_task.metadata->'crop_cycle_ids' else '[]'::jsonb end) x(raw) where x.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      union select nullif(v_task.metadata->>'source_crop_cycle_id','')::uuid where coalesce(v_task.metadata->>'source_crop_cycle_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      union select nullif(v_task.metadata->>'canonical_crop_cycle_id','')::uuid where coalesce(v_task.metadata->>'canonical_crop_cycle_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ), valid_cycles as (
      select distinct cc.id from cycle_ids c join atlas.crop_cycles cc on cc.id=c.id and cc.farm_id=v_task.farm_id and coalesce(cc.lifecycle_status,'active')='active'
    ), eval as (
      select vc.id, atlas.crop_destination_claim_coverage_v1(vc.id) coverage,
        exists(select 1 from atlas.task_crop_cycles tc2 join atlas.tasks rt on rt.id=tc2.task_id where tc2.crop_cycle_id=vc.id and rt.status in ('open','blocked') and rt.task_type in ('spatial_destination_resolution','spatial_destination_reconciliation')) has_resolution
      from valid_cycles vc
    )
    select count(*)::integer,count(*) filter(where coalesce((coverage->>'spatialReleaseAllowed')::boolean,false))::integer,count(*) filter(where has_resolution)::integer
    into v_cycle_count,v_ready_cycle_count,v_resolution_count from eval;

    if v_cycle_count>0 and v_ready_cycle_count=v_cycle_count then
      v_state:='ready'; v_ready:=true; v_source:='crop_destination_claim';
      select coalesce(jsonb_agg(jsonb_build_object('cropCycleId',dc.crop_cycle_id,'claimId',dc.id,'destinationObjectId',dc.destination_object_id,
        'claimedQuantity',dc.claimed_quantity,'unit',dc.unit,'claimStrength',dc.claim_strength,'requiredBy',dc.required_by) order by dc.crop_cycle_id,dc.created_at),'[]'::jsonb)
      into v_claims from atlas.crop_destination_claims dc where dc.status='active' and dc.crop_cycle_id in (
        select tc.crop_cycle_id from atlas.task_crop_cycles tc where tc.task_id=v_task.id
        union select x.raw::uuid from jsonb_array_elements_text(case when jsonb_typeof(v_task.metadata->'crop_cycle_ids')='array' then v_task.metadata->'crop_cycle_ids' else '[]'::jsonb end) x(raw) where x.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      );
    elsif coalesce(v_zone_key,'')<>'grow_room' and v_task.zone_id is not null then v_state:='ready'; v_ready:=true; v_source:='canonical_execution_zone';
    else
      v_state:='destination_required'; v_ready:=false; v_source:=case when v_resolution_count>0 then 'destination_resolution_path' when v_zone_key='grow_room' then 'source_zone_only' else 'missing_destination_context' end;
      v_reason:=case when v_resolution_count>0 then 'A destination-resolution path exists, but destination claim coverage is not yet sufficient for release.'
        when v_destination_text is null then 'Final transplant work has no canonical destination object or sufficiently covered crop destination claim.'
        when lower(v_destination_text) ~ '(choose|unknown|tbd|to be determined|at transplant time)' then 'Final transplant destination is explicitly unresolved.'
        else 'A text destination exists, but final transplant execution still needs a canonical destination object, sufficiently covered crop destination claim, or non-source execution zone.' end;
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object('contractVersion','task_execution_destination_readiness_v1','taskId',v_task.id,'state',v_state,'ready',v_ready,'reason',v_reason,'source',v_source,
    'operationClass',nullif(v_operation,''),'taskType',nullif(v_type,''),'taskZoneKey',v_zone_key,'destinationObjectId',v_destination_id,'destinationObjectExists',v_destination_exists,
    'destinationText',v_destination_text,'subjectCycleCount',v_cycle_count,'spatiallyReadySubjectCycleCount',v_ready_cycle_count,'resolutionPathCount',v_resolution_count,'destinationClaims',v_claims,
    'truthBoundary',jsonb_build_object('metadataDestinationIsNotCanonicalClaim',true,'resolutionPathDoesNotEqualReady',true,'productionTransplantUsesNativeGate',true,'knownMoveQuantityRequiresClaimCoverage',true)));
end;
$function$;