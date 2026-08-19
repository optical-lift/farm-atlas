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
  v_continuation jsonb;
  v_required_by date;
  v_weather_required boolean:=false;
  v_weather_status text;
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
         )) order by c.required_by nulls last,go.label,c.id),'[]'::jsonb),
         min(c.required_by)
  into v_claim_count,v_claims,v_required_by
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
    where pwo.state in ('planned','eligible','released')
      and (
        (pwo.source_kind='crop_cycle_destination' and pwo.source_id=v_cycle.id)
        or (
          pwo.source_kind='task_destination_resolution'
          and exists(
            select 1
            from jsonb_array_elements(coalesce(pwo.relation_payload->'task_crop_cycles','[]'::jsonb)) rel
            where rel->>'crop_cycle_id'=v_cycle.id::text
          )
        )
      )
    order by case when pwo.source_kind='crop_cycle_destination' then 0 else 1 end,pwo.created_at desc
    limit 1;
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

  v_weather_required:=lower(coalesce(v_cycle.metadata->>'weather_release_required','false')) in ('true','yes','1');
  v_weather_status:=lower(coalesce(v_cycle.metadata->>'weather_release_status',''));
  if v_destination_warrant then
    if v_weather_required and v_weather_status not in ('ready','released','satisfied') then
      v_continuation:=jsonb_build_object(
        'state','waiting_weather_release','operationFunction','wait_recheck','requiredBy',v_required_by,
        'spatialWarrantEstablished',true,'executionReleaseEstablished',false,
        'reason','Destination claims are complete, but the crop record still requires a weather release gate.'
      );
    elsif v_required_by is not null and v_required_by>(now() at time zone 'America/Chicago')::date then
      v_continuation:=jsonb_build_object(
        'state','waiting_required_by_window','operationFunction','wait','requiredBy',v_required_by,
        'spatialWarrantEstablished',true,'executionReleaseEstablished',false,
        'reason','Destination claims are complete and the move remains inside a future required-by window.'
      );
    else
      v_continuation:=jsonb_build_object(
        'state','destination_claimed_other_gates_remain','operationFunction','evaluate_release','requiredBy',v_required_by,
        'spatialWarrantEstablished',true,'executionReleaseEstablished',false,
        'reason','Spatial warrant is established; timing, biological, weather, resource, and human-capacity gates remain independent.'
      );
    end if;
  elsif v_resolution is not null then
    v_continuation:=jsonb_build_object(
      'state',case when v_resolution->>'taskType'='spatial_destination_reconciliation' then 'source_reconciliation_required' else 'destination_resolution_required' end,
      'operationFunction',case when v_resolution->>'taskType'='spatial_destination_reconciliation' then 'inspect_reconcile' else 'resolve_destination' end,
      'spatialWarrantEstablished',false,'executionReleaseEstablished',false,'resolutionPath',v_resolution,
      'reason',coalesce(v_resolution->>'reason','A lawful Farm Operations resolution path exists.')
    );
  else
    v_continuation:=jsonb_build_object(
      'state','spatial_continuity_breach','operationFunction','resolve_destination','spatialWarrantEstablished',false,
      'executionReleaseEstablished',false,'reason','No canonical destination claim or explicit resolution path is represented.'
    );
  end if;

  return jsonb_build_object(
    'contractVersion','crop_spatial_destination_reality_expression_v1',
    'subject',jsonb_strip_nulls(jsonb_build_object('cropCycleId',v_cycle.id,'cropCycleKey',v_cycle.crop_cycle_key,'cropLabel',v_cycle.crop_label,
      'variety',v_cycle.variety,'cycleState',v_cycle.cycle_state,'lifecycleStatus',v_cycle.lifecycle_status)),
    'currentLocation',jsonb_strip_nulls(jsonb_build_object('objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,'zoneKey',v_zone_key,
      'recordedPlacements',v_placements)),
    'destination',jsonb_build_object('state',v_state,'destinationWarrantEstablished',v_destination_warrant,'coverage',v_coverage,
      'activeClaims',v_claims,'resolutionPath',v_resolution,'legacyCandidateDestinations',v_legacy),
    'continuation',v_continuation,
    'releaseBoundary',jsonb_build_object('spatialReleaseAllowed',v_destination_warrant,'executionReleaseAllowed',false,
      'principle','Spatial warrant answers where the body may lawfully move. It does not by itself satisfy timing, weather, biological, resource, or human-capacity gates.'),
    'truthBoundary',jsonb_build_object('currentPlacementIsNotFutureDestination',true,'claimIsNotOccupancy',true,'claimIsNotDestinationReadiness',true,
      'metadataCandidateIsNotCanonicalClaim',true,'plannedOccurrenceIsLawfulContinuationNotRelease',true,'spatialWarrantIsNotFullExecutionRelease',true,
      'noDestinationNoConfidentRelease',true,'resolutionPathDoesNotEqualRelease',true)
  );
end;
$function$;