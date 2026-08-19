create or replace function atlas.task_resource_requirement_packet_v1(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  with task_row as (
    select t.id,t.farm_id,t.metadata
    from atlas.tasks t
    where t.id=p_task_id
  ), normalized as (
    select
      rr.id as requirement_id,
      rr.resource_id,
      rr.requirement_role,
      rr.requirement_source,
      rr.quantity_needed,
      rr.unit,
      rr.status as requirement_status,
      rr.note,
      rr.metadata as requirement_metadata
    from atlas.task_resource_requirements rr
    where rr.task_id=p_task_id
  ), metadata_required as (
    select
      null::uuid as requirement_id,
      r.id as resource_id,
      'required'::text as requirement_role,
      'task_metadata'::text as requirement_source,
      null::numeric as quantity_needed,
      r.unit,
      case when atlas.resource_ready_for_requirement_v1(r.id) then 'available' else 'needed' end as requirement_status,
      null::text as note,
      jsonb_build_object('sourceKey',wanted.stable_key) as requirement_metadata
    from task_row t
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(t.metadata->'required_resource_keys','[]'::jsonb))='array'
          then coalesce(t.metadata->'required_resource_keys','[]'::jsonb)
        else '[]'::jsonb
      end
    ) wanted(stable_key)
    join atlas.resources r on r.farm_id=t.farm_id and r.stable_key=wanted.stable_key
    where not exists(
      select 1 from normalized n where n.resource_id=r.id
    )
  ), links as (
    select * from normalized
    union all
    select * from metadata_required
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'requirementId',l.requirement_id,
    'resourceId',r.id,
    'resourceKey',r.stable_key,
    'resourceLabel',r.label,
    'resourceType',r.resource_type,
    'resourceCategory',r.resource_category,
    'resourceStatus',r.status,
    'requirementRole',l.requirement_role,
    'requirementSource',l.requirement_source,
    'quantityNeeded',l.quantity_needed,
    'unit',coalesce(l.unit,s.unit,r.unit),
    'requirementStatus',l.requirement_status,
    'requirementReady',case when l.requirement_id is not null
      then atlas.resource_requirement_ready_v1(l.requirement_id)
      else atlas.resource_ready_for_requirement_v1(r.id)
    end,
    'note',l.note,
    'readinessState',s.readiness_state,
    'quantityState',s.quantity_state,
    'knownQuantity',s.known_quantity,
    'stateReason',s.state_reason,
    'stateConsequences',atlas.current_state_consequences_v1('resource',r.id),
    'metadata',l.requirement_metadata
  )) order by
    case l.requirement_role when 'required' then 0 when 'check_first' then 1 when 'reserved' then 2 else 3 end,
    r.label,r.id),'[]'::jsonb)
  from links l
  join atlas.resources r on r.id=l.resource_id
  left join atlas.resource_operational_state s on s.resource_id=r.id;
$$;

revoke all on function atlas.task_resource_requirement_packet_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.task_resource_requirement_packet_v1(uuid) to service_role;

create or replace function atlas.task_state_consequence_gate_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_resource_packet jsonb := '[]'::jsonb;
  v_seed_readiness jsonb := '{}'::jsonb;
  v_seed_ready boolean := true;
  v_blocking jsonb := '[]'::jsonb;
  v_preparation jsonb := '[]'::jsonb;
  v_blocking_count integer := 0;
  v_preparation_count integer := 0;
begin
  if not exists(select 1 from atlas.tasks where id=p_task_id) then
    return jsonb_build_object(
      'contractVersion','task_state_consequence_gate_v1',
      'taskId',p_task_id,
      'state','task_missing',
      'blocking',true,
      'blockingCount',1,
      'preparationCount',0,
      'blockingConsequences','[]'::jsonb,
      'preparationConsequences','[]'::jsonb
    );
  end if;

  v_resource_packet := atlas.task_resource_requirement_packet_v1(p_task_id);
  v_seed_readiness := atlas.task_seed_readiness_v1(p_task_id);
  v_seed_ready := coalesce((v_seed_readiness->>'ready')::boolean,false);

  with resource_consequence_rows as (
    select
      packet.value as requirement,
      consequence.value as consequence,
      coalesce((packet.value->>'requirementReady')::boolean,false) as requirement_ready,
      coalesce(packet.value->>'requirementRole','required') as requirement_role
    from jsonb_array_elements(v_resource_packet) packet(value)
    cross join lateral jsonb_array_elements(coalesce(packet.value->'stateConsequences','[]'::jsonb)) consequence(value)
  ), seed_consequence_rows as (
    select
      jsonb_strip_nulls(jsonb_build_object(
        'seedLotId',sl.id,
        'seedLotKey',sl.stable_key,
        'seedLotLabel',sl.lot_label,
        'linkRole',stl.link_role,
        'seedReady',v_seed_ready
      )) as requirement,
      consequence.value as consequence,
      v_seed_ready as requirement_ready,
      'seed_input'::text as requirement_role
    from atlas.seed_lot_task_links stl
    join atlas.seed_lots sl on sl.id=stl.seed_lot_id
    cross join lateral jsonb_array_elements(atlas.current_state_consequences_v1('seed_lot',sl.id)) consequence(value)
    where stl.task_id=p_task_id
  ), consequence_rows as (
    select 'resource'::text as subject_kind,* from resource_consequence_rows
    union all
    select 'seed_lot'::text as subject_kind,* from seed_consequence_rows
  ), classified as (
    select *,
      case
        when requirement_role in ('required','seed_input') and not requirement_ready then 'blocking'
        else 'preparation'
      end as gate_class
    from consequence_rows
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'subjectKind',subject_kind,
      'requirement',requirement,
      'consequence',consequence
    )) filter(where gate_class='blocking'),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'subjectKind',subject_kind,
      'requirement',requirement,
      'consequence',consequence
    )) filter(where gate_class='preparation'),'[]'::jsonb),
    count(*) filter(where gate_class='blocking')::integer,
    count(*) filter(where gate_class='preparation')::integer
  into v_blocking,v_preparation,v_blocking_count,v_preparation_count
  from classified;

  return jsonb_build_object(
    'contractVersion','task_state_consequence_gate_v1',
    'taskId',p_task_id,
    'state',case
      when v_blocking_count>0 then 'blocked'
      when v_preparation_count>0 then 'preparation_required'
      else 'clear'
    end,
    'blocking',(v_blocking_count>0),
    'preparationRequired',(v_preparation_count>0),
    'blockingCount',v_blocking_count,
    'preparationCount',v_preparation_count,
    'blockingConsequences',v_blocking,
    'preparationConsequences',v_preparation,
    'resourceRequirements',v_resource_packet,
    'seedReadiness',v_seed_readiness,
    'truthBoundary',jsonb_build_object(
      'stateConsequenceDoesNotReplaceDomainReadiness',true,
      'restockBelowPolicyDoesNotAutomaticallyBlockCurrentOperation',true,
      'checkFirstIsPreparationNotExecutionBlock',true,
      'legacyResourceStatusMayBlockWhenItIsTheBestAvailableCanonicalState',true
    )
  );
end;
$$;

revoke all on function atlas.task_state_consequence_gate_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.task_state_consequence_gate_v1(uuid) to service_role;

create or replace function atlas.task_execution_readiness_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_prereq boolean;
  v_resources boolean;
  v_destination jsonb;
  v_seed jsonb;
  v_seed_ready boolean;
  v_state_gate jsonb;
  v_state_gate_clear boolean;
begin
  v_prereq:=atlas.task_prerequisites_ready_v1(p_task_id);
  v_resources:=atlas.task_required_resources_available_v1(p_task_id);
  v_destination:=atlas.task_execution_destination_readiness_v1(p_task_id);
  v_seed:=atlas.task_seed_readiness_v1(p_task_id);
  v_seed_ready:=coalesce((v_seed->>'ready')::boolean,false);
  v_state_gate:=atlas.task_state_consequence_gate_v1(p_task_id);
  v_state_gate_clear:=not coalesce((v_state_gate->>'blocking')::boolean,false);

  return jsonb_build_object(
    'contractVersion','task_execution_readiness_v2',
    'taskId',p_task_id,
    'ready',v_prereq and v_resources and coalesce((v_destination->>'ready')::boolean,false) and v_seed_ready and v_state_gate_clear,
    'prerequisitesReady',v_prereq,
    'resourcesReady',v_resources,
    'destinationReady',coalesce((v_destination->>'ready')::boolean,false),
    'seedReady',v_seed_ready,
    'stateConsequenceClear',v_state_gate_clear,
    'preparationRequired',coalesce((v_state_gate->>'preparationRequired')::boolean,false),
    'destination',v_destination,
    'seed',v_seed,
    'stateConsequenceGate',v_state_gate
  );
end;
$$;

create or replace function atlas.worker_day_operational_task_cards_v3(
  p_farm_id uuid,
  p_membership_id uuid,
  p_service_date date,
  p_task_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_cards jsonb := '[]'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_card jsonb;
  v_task_id uuid;
  v_readiness jsonb;
  v_status text;
begin
  v_cards:=atlas.worker_day_operational_task_cards_v2(
    p_farm_id,p_membership_id,p_service_date,p_task_ids
  );

  for v_card in select value from jsonb_array_elements(v_cards)
  loop
    v_task_id:=nullif(v_card->>'task_id','')::uuid;
    v_status:=coalesce(v_card->>'status','');
    v_readiness:=atlas.task_execution_readiness_v1(v_task_id);

    if v_status='done' or coalesce((v_readiness->>'ready')::boolean,false) then
      v_result:=v_result || jsonb_build_array(
        v_card
        || jsonb_build_object(
          'resource_requirements',atlas.task_resource_requirement_packet_v1(v_task_id),
          'execution_readiness',v_readiness,
          'state_consequence_gate',v_readiness->'stateConsequenceGate',
          'preparation_required',coalesce((v_readiness->>'preparationRequired')::boolean,false)
        )
      );
    end if;
  end loop;

  return v_result;
end;
$$;

revoke all on function atlas.worker_day_operational_task_cards_v3(uuid,uuid,date,uuid[]) from public, anon, authenticated;
grant execute on function atlas.worker_day_operational_task_cards_v3(uuid,uuid,date,uuid[]) to service_role;

create or replace function atlas.worker_self_day_plan_api_v1(p_farm_id uuid, p_membership_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_plan jsonb;
  v_timeline jsonb;
  v_ordered jsonb;
  v_deferred jsonb := '[]'::jsonb;
  v_first jsonb;
  v_first_task_id uuid;
  v_first_readiness jsonb;
  v_decision jsonb;
  v_next jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A worker day is required.' using errcode='22023';
  end if;
  if not exists(
    select 1
    from atlas.farm_memberships membership
    where membership.id=p_membership_id
      and membership.farm_id=p_farm_id
      and membership.user_id=auth.uid()
      and membership.active=true
      and membership.role='farm_hand'
  ) then
    raise exception 'The Farm Hand Worker Day plan may only be read by that active Farm Hand.' using errcode='42501';
  end if;

  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_plan:=atlas.worker_day_selection_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_deferred:=coalesce(v_plan->'nextUp','[]'::jsonb);
  v_plan:=jsonb_set(v_plan,'{suggestions}','[]'::jsonb,true);

  v_timeline:=atlas.worker_day_chronology_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_ordered:=atlas.worker_day_chronology_ordered_v1(v_timeline,p_day);

  select item.value
  into v_first
  from jsonb_array_elements(coalesce(v_ordered->'items','[]'::jsonb)) with ordinality item(value,ordinality)
  where coalesce(item.value->>'chronologyState','') in (
      'committed_timed','proposed','proposed_outside_preferred_window'
    )
    and coalesce(nullif(item.value->>'durationMinutes','')::integer,0)>0
    and (
      nullif(item.value->>'taskId','') is null
      or (
        coalesce(item.value->>'taskId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and coalesce((atlas.task_execution_readiness_v1((item.value->>'taskId')::uuid)->>'ready')::boolean,false)
      )
    )
  order by item.ordinality
  limit 1;

  if v_first is not null then
    if coalesce(v_first->>'taskId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_first_task_id:=(v_first->>'taskId')::uuid;
      v_first_readiness:=atlas.task_execution_readiness_v1(v_first_task_id);
    else
      v_first_task_id:=null;
      v_first_readiness:=null;
    end if;

    v_next:=jsonb_build_array(
      v_first || jsonb_strip_nulls(jsonb_build_object(
        'nextUpReason','clock_sequence',
        'executableNow',true,
        'executionReadiness',v_first_readiness
      ))
    );
  else
    v_decision:=atlas.worker_next_up_v3(p_farm_id,p_membership_id,p_day);
    if jsonb_typeof(v_decision->'nextUp')='object' then
      v_next:=jsonb_build_array(
        (v_decision->'nextUp') || jsonb_build_object(
          'nextUpReason','decision_engine',
          'executableNow',coalesce(v_decision->>'state','')='ready',
          'executionReadiness',atlas.task_execution_readiness_v1(((v_decision->'nextUp')->>'taskId')::uuid)
        )
      );
    else
      v_next:='[]'::jsonb;
    end if;
  end if;

  v_plan:=jsonb_set(v_plan,'{deferredWork}',v_deferred,true);
  v_plan:=jsonb_set(v_plan,'{nextUp}',v_next,true);
  v_plan:=jsonb_set(v_plan,'{clockTimeline}',v_ordered,true);
  v_plan:=jsonb_set(v_plan,'{nextUpContractVersion}',to_jsonb('worker_self_next_up_v3'::text),true);
  v_plan:=jsonb_set(v_plan,'{contractVersion}',to_jsonb('worker_self_day_plan_v3'::text),true);
  return v_plan;
end;
$$;

create or replace function atlas.worker_self_day_bundle_api_v1(p_farm_id uuid, p_membership_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_plan jsonb;
  v_task_ids uuid[] := array[]::uuid[];
  v_cards jsonb := '[]'::jsonb;
  v_safe_cards jsonb := '[]'::jsonb;
begin
  v_plan := atlas.worker_self_day_plan_api_v1(p_farm_id, p_membership_id, p_day);

  select coalesce(
    array_agg(distinct item.task_id) filter (where item.task_id is not null),
    array[]::uuid[]
  )
  into v_task_ids
  from (
    select nullif(row->>'taskId', '')::uuid as task_id
    from jsonb_array_elements(
      coalesce(v_plan->'realWork', '[]'::jsonb)
      || coalesce(v_plan->'automaticWork', '[]'::jsonb)
    ) row
  ) item;

  v_cards := atlas.worker_day_operational_task_cards_v3(
    p_farm_id,
    p_membership_id,
    p_day,
    v_task_ids
  );

  select coalesce(jsonb_agg(card - 'move_context' order by ord), '[]'::jsonb)
  into v_safe_cards
  from jsonb_array_elements(v_cards) with ordinality as cards(card, ord);

  return jsonb_build_object(
    'contractVersion','worker_self_day_bundle_or7_v1',
    'plan', v_plan,
    'taskCards', v_safe_cards
  );
end;
$$;