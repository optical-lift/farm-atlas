create or replace function atlas.bell_worker_capacity_repair_packets_v1(
  p_farm_id uuid,
  p_as_of_date date default null::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_date date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_capacity jsonb;
  v_worker jsonb;
  v_state jsonb;
  v_items jsonb;
  v_samples jsonb;
  v_ids text;
  v_fingerprint text;
  v_count integer;
  v_minutes integer;
  v_blocked_count integer;
  v_blocked_minutes integer;
  v_week_start text;
  v_packets jsonb:='[]'::jsonb;
begin
  v_capacity:=atlas.farm_worker_capacity_continuity_v1(p_farm_id,v_date);

  for v_worker in
    select value
    from jsonb_array_elements(coalesce(v_capacity->'workers','[]'::jsonb))
  loop
    if coalesce(v_worker->>'state','')<>'placement_required' then
      continue;
    end if;

    v_state:=coalesce(v_worker->'managementState','{}'::jsonb);

    -- A placement divergence is only execution-ready required work that lacks
    -- a lawful Worker Day placement. Required work that is blocked by a
    -- governed prerequisite/resource state is an obligation, but it is not
    -- currently placeable capacity and therefore is not itself a placement
    -- divergence.
    v_items:=coalesce(v_state->'readyUnplacedRequiredWork','[]'::jsonb);
    v_count:=coalesce(
      nullif(v_state->>'readyUnplacedRequiredCount','')::integer,
      jsonb_array_length(v_items)
    );
    v_minutes:=coalesce(
      nullif(v_state->>'readyUnplacedRequiredMinutes','')::integer,
      0
    );
    v_blocked_count:=coalesce(nullif(v_state->>'blockedRequiredCount','')::integer,0);
    v_blocked_minutes:=coalesce(nullif(v_state->>'blockedRequiredMinutes','')::integer,0);
    v_week_start:=coalesce(v_state->>'weekStart',v_capacity->>'weekStart',v_date::text);

    if v_count<=0 then
      continue;
    end if;

    select string_agg(subject_id,',' order by subject_id)
    into v_ids
    from (
      select distinct coalesce(
        nullif(item->>'claimSubject',''),
        nullif(item->>'taskId',''),
        md5(item::text)
      ) subject_id
      from jsonb_array_elements(v_items) item
    ) x;

    v_fingerprint:=md5(concat_ws(
      '|',
      'ready_required_work_placement',
      v_worker->>'membershipId',
      v_week_start,
      v_count::text,
      v_minutes::text,
      coalesce(v_ids,'')
    ));

    select coalesce(jsonb_agg(item order by ord),'[]'::jsonb)
    into v_samples
    from jsonb_array_elements(v_items) with ordinality x(item,ord)
    where ord<=8;

    v_packets:=v_packets||jsonb_build_array(jsonb_build_object(
      'contractVersion','bell_repair_packet_v2',
      'repairKey','placement:'||(v_worker->>'membershipId')||':'||v_week_start,
      'fingerprint',v_fingerprint,
      'source',jsonb_build_object(
        'kind','worker_weekly_ready_required_placement',
        'contractVersion',v_state->>'contractVersion',
        'membershipId',v_worker->>'membershipId',
        'weekStart',v_week_start,
        'asOfDate',v_date
      ),
      'divergenceClass','labor_claim_placement',
      'severity','medium',
      'itemCount',v_count,
      'title','Place '||v_count::text||' execution-ready required work claim'||case when v_count=1 then '' else 's' end||' into Worker Day',
      'observedTruth',format(
        '%s execution-ready required work claim%s (%s modeled minutes) are known for the week but have no lawful Worker Day placement yet.',
        v_count,
        case when v_count=1 then '' else 's' end,
        v_minutes
      ),
      'expectedTruth','Every execution-ready required weekly work claim is placed into lawful Worker Day capacity or explicitly held by a management decision. Required work blocked by governed prerequisites or resources remains an obligation but does not pretend to be placeable capacity.',
      'differenceSummary','Execution-ready required work is known, but day-by-day placement is incomplete. Governed blocked work is tracked separately and is not counted as a placement divergence.',
      'consequence',coalesce(
        v_state->>'consequence',
        'Execution-ready required work remains unplaced until management places it into lawful Worker Day capacity.'
      ),
      'owningFunction',jsonb_build_object(
        'domain','farm_operations_management',
        'function','place_required_work_in_capacity_window',
        'jurisdiction','management'
      ),
      'repairRoute',jsonb_build_object(
        'surface','bell',
        'recipientFunction','farm_operations_management',
        'humanActionRequired',true,
        'authoringEndpoint','atlas.management_commit_worker_required_placements_v1(uuid,uuid,uuid,jsonb)'
      ),
      'workerResponsibility',jsonb_build_object(
        'state','not_assigned_by_divergence',
        'principle','Missing management placement does not establish worker failure. The worker is the execution carrier only after work is lawfully placed.'
      ),
      'sampleItems',v_samples,
      'blockedRequiredContext',jsonb_build_object(
        'count',v_blocked_count,
        'modeledMinutes',v_blocked_minutes,
        'state','governed_separately',
        'principle','Blocked required work remains an obligation but is not a Worker Day placement claim until its governing gate clears.'
      ),
      'drilldown',jsonb_build_object(
        'function','atlas.worker_weekly_capacity_management_state_v2',
        'membershipId',v_worker->>'membershipId',
        'weekStart',v_week_start
      ),
      'managementDecisionRequired',v_state->>'managementDecisionRequired',
      'managementOptions',v_state->'managementOptions',
      'truthBoundary',jsonb_build_object(
        'aggregateWeeklyFitDoesNotProveDailyPlacement',true,
        'placementGapIsNotCapacityOverload',true,
        'unplacedRequiredWorkIsNotOptionalBacklog',true,
        'blockedRequiredWorkIsNotPlacementDivergence',true,
        'blockedRequiredWorkDoesNotConsumePlaceableCapacity',true,
        'managementOwnsPlacementBeforePrincipalEscalation',true,
        'workerBlameNotInferred',true,
        'principalEscalationNotCreated',true
      )
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','bell_worker_capacity_repair_packets_v1',
    'farmId',p_farm_id,
    'asOfDate',v_date,
    'packetCount',jsonb_array_length(v_packets),
    'packets',v_packets,
    'workerCapacityContinuity',v_capacity
  );
end;
$function$;