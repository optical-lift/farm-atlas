create or replace function atlas.farm_continuity_audit_v4(p_farm_id uuid, p_as_of_date date default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_base jsonb;
  v_old_hardening jsonb:='{}'::jsonb;
  v_old_transplant jsonb:='{}'::jsonb;
  v_old_no_next jsonb:='{}'::jsonb;
  v_hardening_items jsonb:='[]'::jsonb;
  v_transplant_items jsonb:='[]'::jsonb;
  v_no_next_items jsonb:='[]'::jsonb;
  v_governed_items jsonb:='[]'::jsonb;
  v_hardening_count integer:=0;
  v_transplant_count integer:=0;
  v_no_next_count integer:=0;
  v_governed_count integer:=0;
  v_old_hardening_count integer:=0;
  v_old_transplant_count integer:=0;
  v_old_no_next_count integer:=0;
  v_high integer:=0;
  v_medium integer:=0;
  v_state text;
  v_families jsonb:='[]'::jsonb;
begin
  v_base:=atlas.farm_continuity_audit_v3(p_farm_id,p_as_of_date);

  select coalesce(f,'{}'::jsonb) into v_old_hardening
  from jsonb_array_elements(v_base->'issueFamilies') f where f->>'key'='hardening_off_uncovered' limit 1;
  select coalesce(f,'{}'::jsonb) into v_old_transplant
  from jsonb_array_elements(v_base->'issueFamilies') f where f->>'key'='transplant_destination_unresolved' limit 1;
  select coalesce(f,'{}'::jsonb) into v_old_no_next
  from jsonb_array_elements(v_base->'issueFamilies') f where f->>'key'='no_lawful_next_state' limit 1;

  v_old_hardening_count:=coalesce((v_old_hardening->>'count')::integer,0);
  v_old_transplant_count:=coalesce((v_old_transplant->>'count')::integer,0);
  v_old_no_next_count:=coalesce((v_old_no_next->>'count')::integer,0);

  with evaluated as (
    select item,atlas.crop_spatial_destination_reality_expression_v1((item->>'cycleId')::uuid) packet
    from jsonb_array_elements(coalesce(v_old_hardening->'items','[]'::jsonb)) item
  ), unresolved as (
    select item from evaluated
    where not (
      coalesce((packet#>>'{destination,destinationWarrantEstablished}')::boolean,false)
      or packet#>'{destination,resolutionPath}' is not null
    )
  )
  select count(*)::integer,coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_hardening_count,v_hardening_items from unresolved;

  with unresolved as (
    select item
    from jsonb_array_elements(coalesce(v_old_transplant->'items','[]'::jsonb)) item
    where coalesce((item#>>'{destinationReadiness,resolutionPathCount}')::integer,0)=0
  )
  select count(*)::integer,coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_transplant_count,v_transplant_items from unresolved;

  with evaluated as (
    select item,
           case when item->>'cycleState'='hardening_off'
                then atlas.crop_spatial_destination_reality_expression_v1((item->>'cropCycleId')::uuid)
                else null end packet
    from jsonb_array_elements(coalesce(v_old_no_next->'items','[]'::jsonb)) item
  ), unresolved as (
    select item from evaluated
    where not (
      item->>'cycleState'='hardening_off'
      and (
        coalesce((packet#>>'{destination,destinationWarrantEstablished}')::boolean,false)
        or packet#>'{destination,resolutionPath}' is not null
      )
    )
  )
  select count(*)::integer,coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_no_next_count,v_no_next_items from unresolved;

  with governed as (
    select jsonb_strip_nulls(jsonb_build_object(
      'sourceIssue','hardening_off_uncovered',
      'cropCycleId',item->>'cycleId',
      'cropLabel',item->>'cropLabel',
      'variety',item->>'variety',
      'spatialDestination',packet->'destination',
      'continuation',packet->'continuation',
      'reason','The hardening-off body now has either complete canonical destination claims or an explicit Farm Operations resolution/reconciliation path.'
    )) item
    from (
      select item,atlas.crop_spatial_destination_reality_expression_v1((item->>'cycleId')::uuid) packet
      from jsonb_array_elements(coalesce(v_old_hardening->'items','[]'::jsonb)) item
    ) e
    where coalesce((packet#>>'{destination,destinationWarrantEstablished}')::boolean,false)
       or packet#>'{destination,resolutionPath}' is not null
    union all
    select jsonb_strip_nulls(jsonb_build_object(
      'sourceIssue','transplant_destination_unresolved',
      'taskId',item->>'taskId',
      'title',item->>'title',
      'destinationReadiness',item->'destinationReadiness',
      'reason','The transplant remains blocked, but a lawful Farm Operations destination-resolution path now exists; this is governed continuation rather than silent absence.'
    ))
    from jsonb_array_elements(coalesce(v_old_transplant->'items','[]'::jsonb)) item
    where coalesce((item#>>'{destinationReadiness,resolutionPathCount}')::integer,0)>0
  )
  select count(*)::integer,coalesce(jsonb_agg(item),'[]'::jsonb)
  into v_governed_count,v_governed_items from governed;

  v_high:=coalesce((v_base#>>'{summary,highPriorityIssueCount}')::integer,0)
          -(v_old_hardening_count-v_hardening_count)
          -(v_old_transplant_count-v_transplant_count)
          -(v_old_no_next_count-v_no_next_count);
  v_medium:=coalesce((v_base#>>'{summary,mediumPriorityIssueCount}')::integer,0);
  v_state:=case when v_high>0 then 'high_priority_continuity_attention'
                when v_medium>0 then 'continuity_attention'
                else 'no_actionable_continuity_gap_detected' end;

  select coalesce(jsonb_agg(f order by ord),'[]'::jsonb)
  into v_families
  from jsonb_array_elements(v_base->'issueFamilies') with ordinality x(f,ord)
  where f->>'key' not in ('hardening_off_uncovered','transplant_destination_unresolved','no_lawful_next_state');

  v_families:=v_families || jsonb_build_array(
    jsonb_build_object('key','hardening_off_uncovered','severity','high','count',v_hardening_count,'items',v_hardening_items),
    jsonb_build_object('key','transplant_destination_unresolved','severity','high','count',v_transplant_count,'items',v_transplant_items),
    jsonb_build_object('key','no_lawful_next_state','severity','high','count',v_no_next_count,'items',v_no_next_items),
    jsonb_build_object('key','spatial_destination_governed_continuation','severity','context','count',v_governed_count,'items',v_governed_items)
  );

  return v_base || jsonb_build_object(
    'contractVersion','farm_continuity_audit_v4',
    'state',v_state,
    'summary',(v_base->'summary') || jsonb_build_object(
      'highPriorityIssueCount',v_high,
      'mediumPriorityIssueCount',v_medium,
      'hardeningOffUncoveredCount',v_hardening_count,
      'transplantDestinationUnresolvedCount',v_transplant_count,
      'noLawfulNextStateCount',v_no_next_count,
      'spatialDestinationGovernedContinuationCount',v_governed_count
    ),
    'issueFamilies',v_families,
    'auditCoverage',(v_base->'auditCoverage') || jsonb_build_object(
      'spatialDestinationClaims','audited_from_crop_destination_claims_and_crop_destination_claim_coverage_v1',
      'spatialDestinationResolutionPaths','audited_from_live_tasks_and_planned_work_occurrences_with_preserved_relation_payload',
      'currentPlacementVsFutureDestination','current_placement_is_never_treated_as_future_destination_warrant'
    ),
    'truthBoundary',(v_base->'truthBoundary') || jsonb_build_object(
      'completeDestinationClaimMayBeLawfulWaitState',true,
      'resolutionOccurrenceIsContinuationNotExecutionRelease',true,
      'currentPlacementIsNotFutureDestination',true,
      'spatialWarrantDoesNotSatisfyWeatherOrTiming',true
    ),
    'principalEscalationCreated',false
  );
end;
$function$;

revoke all on function atlas.farm_continuity_audit_v4(uuid,date) from public,anon;
grant execute on function atlas.farm_continuity_audit_v4(uuid,date) to authenticated,service_role;

-- Ordered authenticated RPC registry reconciliation follows immediately in
-- 20260818042828_spatial_destination_rpc_registry_v1.sql via atlas.authenticated_rpc_registry.