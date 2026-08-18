create or replace function atlas.ensure_crop_destination_resolution_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_existing atlas.tasks%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
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

  select * into v_occurrence
  from atlas.planned_work_occurrences pwo
  where pwo.source_kind='crop_cycle_destination' and pwo.source_id=v_cycle.id
    and pwo.state in ('planned','eligible','released')
  order by pwo.created_at desc limit 1;
  if v_occurrence.id is not null then
    return jsonb_build_object('cropCycleId',v_cycle.id,'state','resolution_path_open','occurrenceId',v_occurrence.id,'occurrenceState',v_occurrence.state,'releasedTaskId',v_occurrence.released_task_id,'created',false);
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
  with unique_done_tasks as (
    select distinct t.id,t.metadata
    from atlas.task_crop_cycles tc
    join atlas.tasks t on t.id=tc.task_id
    where tc.crop_cycle_id=v_cycle.id and t.status='done' and t.task_type='transplanting'
  )
  select coalesce(sum(coalesce(nullif(metadata->>'quantity','')::numeric,nullif(metadata->>'total_quantity','')::numeric,0)),0)
  into v_done_target
  from unique_done_tasks;

  if v_allocated is not null and v_allocated>0 and v_done_target>=v_allocated then
    v_task_type:='spatial_destination_reconciliation';
    v_title:='Inspect remaining transplant stock — '||coalesce(v_cycle.variety,v_cycle.crop_label);
    v_reason:='Unique completed transplant cards account for the recorded allocated cohort, but task completion alone does not prove the source body is empty. Inspect remaining material before reclassifying or assigning more destinations.';
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

  return jsonb_build_object('cropCycleId',v_cycle.id,'state','resolution_path_open','taskId',v_task.id,'plannedOccurrenceId',v_task.planned_occurrence_id,'taskType',v_task_type,'created',true);
end;
$function$;

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
  v_occurrence atlas.planned_work_occurrences%rowtype;
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

  select * into v_occurrence
  from atlas.planned_work_occurrences pwo
  where pwo.source_kind='task_destination_resolution' and pwo.source_id=v_task.id
    and pwo.state in ('planned','eligible','released')
  order by pwo.created_at desc limit 1;
  if v_occurrence.id is not null then
    return jsonb_build_object('sourceTaskId',v_task.id,'state','resolution_path_open','occurrenceId',v_occurrence.id,'occurrenceState',v_occurrence.state,'releasedTaskId',v_occurrence.released_task_id,'created',false);
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

  return jsonb_build_object('sourceTaskId',v_task.id,'state','resolution_path_open','resolutionTaskId',v_resolution.id,'plannedOccurrenceId',v_resolution.planned_occurrence_id,'linkedCropCycleCount',v_count,'created',true);
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

  select jsonb_strip_nulls(jsonb_build_object(
           'pathType','task','taskId',t.id,'title',t.title,'taskType',t.task_type,'status',t.status,'dueDate',t.due_date,
           'visibilityScope',t.visibility_scope,'operationClass',t.operation_class,'reason',t.metadata->>'resolution_reason'))
  into v_resolution
  from atlas.task_crop_cycles tc join atlas.tasks t on t.id=tc.task_id
  where tc.crop_cycle_id=v_cycle.id and t.status in ('open','blocked')
    and t.task_type in ('spatial_destination_resolution','spatial_destination_reconciliation')
  order by t.due_date nulls last,t.created_at limit 1;

  if v_resolution is null then
    select jsonb_strip_nulls(jsonb_build_object(
             'pathType','planned_work_occurrence','occurrenceId',pwo.id,'title',pwo.title,'state',pwo.state,
             'plannedDueDate',pwo.planned_due_date,'notBeforeDate',pwo.not_before_date,'releasedTaskId',pwo.released_task_id,
             'taskType',pwo.task_payload->>'task_type','visibilityScope',pwo.task_payload->>'visibility_scope',
             'reason',pwo.task_payload#>>'{metadata,resolution_reason}'))
    into v_resolution
    from atlas.planned_work_occurrences pwo
    where pwo.source_kind='crop_cycle_destination' and pwo.source_id=v_cycle.id
      and pwo.state in ('planned','eligible','released')
    order by pwo.created_at desc limit 1;
  end if;

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
      'principle','Current placement describes present custody/location and never establishes a future destination. A planned occurrence is a lawful resolution path but does not itself establish release. When moving quantity is known, active destination claims must cover it.'),
    'truthBoundary',jsonb_build_object('currentPlacementIsNotFutureDestination',true,'claimIsNotOccupancy',true,'claimIsNotDestinationReadiness',true,
      'metadataCandidateIsNotCanonicalClaim',true,'plannedOccurrenceIsLawfulContinuationNotRelease',true,'noDestinationNoConfidentRelease',true,'resolutionPathDoesNotEqualRelease',true)
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
        (
          exists(select 1 from atlas.task_crop_cycles tc2 join atlas.tasks rt on rt.id=tc2.task_id where tc2.crop_cycle_id=vc.id and rt.status in ('open','blocked') and rt.task_type in ('spatial_destination_resolution','spatial_destination_reconciliation'))
          or exists(select 1 from atlas.planned_work_occurrences pwo where pwo.source_kind='crop_cycle_destination' and pwo.source_id=vc.id and pwo.state in ('planned','eligible','released'))
        ) has_resolution
      from valid_cycles vc
    )
    select count(*)::integer,count(*) filter(where coalesce((coverage->>'spatialReleaseAllowed')::boolean,false))::integer,count(*) filter(where has_resolution)::integer
    into v_cycle_count,v_ready_cycle_count,v_resolution_count from eval;

    if exists(select 1 from atlas.planned_work_occurrences pwo where pwo.source_kind='task_destination_resolution' and pwo.source_id=v_task.id and pwo.state in ('planned','eligible','released')) then
      v_resolution_count:=greatest(v_resolution_count,1);
    end if;

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
      v_reason:=case when v_resolution_count>0 then 'A lawful destination-resolution path exists in Farm Operations, but destination claim coverage is not yet sufficient for transplant release.'
        when v_destination_text is null then 'Final transplant work has no canonical destination object or sufficiently covered crop destination claim.'
        when lower(v_destination_text) ~ '(choose|unknown|tbd|to be determined|at transplant time)' then 'Final transplant destination is explicitly unresolved.'
        else 'A text destination exists, but final transplant execution still needs a canonical destination object, sufficiently covered crop destination claim, or non-source execution zone.' end;
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object('contractVersion','task_execution_destination_readiness_v1','taskId',v_task.id,'state',v_state,'ready',v_ready,'reason',v_reason,'source',v_source,
    'operationClass',nullif(v_operation,''),'taskType',nullif(v_type,''),'taskZoneKey',v_zone_key,'destinationObjectId',v_destination_id,'destinationObjectExists',v_destination_exists,
    'destinationText',v_destination_text,'subjectCycleCount',v_cycle_count,'spatiallyReadySubjectCycleCount',v_ready_cycle_count,'resolutionPathCount',v_resolution_count,'destinationClaims',v_claims,
    'truthBoundary',jsonb_build_object('metadataDestinationIsNotCanonicalClaim',true,'resolutionPathDoesNotEqualReady',true,'plannedOccurrenceCountsAsResolutionPath',true,'productionTransplantUsesNativeGate',true,'knownMoveQuantityRequiresClaimCoverage',true)));
end;
$function$;

update atlas.planned_work_occurrences pwo
set task_payload = jsonb_set(
      jsonb_set(
        pwo.task_payload,
        '{metadata,prior_done_transplant_target_quantity}',
        to_jsonb(src.unique_done_target),
        true
      ),
      '{metadata,resolution_reason}',
      to_jsonb('Unique completed transplant cards account for the recorded allocated cohort, but task completion alone does not prove the source body is empty. Inspect remaining material before reclassifying or assigning more destinations.'::text),
      true
    ),
    updated_at=now()
from (
  select cc.id,
         coalesce(sum(coalesce(nullif(t.metadata->>'quantity','')::numeric,nullif(t.metadata->>'total_quantity','')::numeric,0)),0) as unique_done_target
  from atlas.crop_cycles cc
  left join lateral (
    select distinct t.id,t.metadata
    from atlas.task_crop_cycles tc
    join atlas.tasks t on t.id=tc.task_id
    where tc.crop_cycle_id=cc.id and t.status='done' and t.task_type='transplanting'
  ) t on true
  where cc.metadata ? 'allocated_seedlings'
  group by cc.id
) src
where pwo.source_kind='crop_cycle_destination'
  and pwo.source_id=src.id
  and pwo.task_payload->>'task_type'='spatial_destination_reconciliation';