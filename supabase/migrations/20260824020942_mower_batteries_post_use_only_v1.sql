CREATE OR REPLACE FUNCTION atlas.task_state_consequence_gate_v1(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'atlas'
AS $function$
declare
  v_resource_packet jsonb := '[]'::jsonb;
  v_display_resource_packet jsonb := '[]'::jsonb;
  v_seed_readiness jsonb := '{}'::jsonb;
  v_seed_ready boolean := true;
  v_blocking jsonb := '[]'::jsonb;
  v_preparation jsonb := '[]'::jsonb;
  v_blocking_count integer := 0;
  v_preparation_count integer := 0;
begin
  if not exists(select 1 from atlas.tasks where id=p_task_id) then
    return jsonb_build_object(
      'contractVersion','task_state_consequence_gate_v1','taskId',p_task_id,
      'state','task_missing','blocking',true,'blockingCount',1,'preparationCount',0,
      'blockingConsequences','[]'::jsonb,'preparationConsequences','[]'::jsonb
    );
  end if;

  v_resource_packet := atlas.task_resource_requirement_packet_v1(p_task_id);
  v_seed_readiness := atlas.task_seed_readiness_v1(p_task_id);
  v_seed_ready := coalesce((v_seed_readiness->>'ready')::boolean,false);

  -- Reusable mower energy is a post-use reset obligation, not a pre-start
  -- readiness question. Keep it in canonical resource truth, but do not expose
  -- it as a Worker Day preparation requirement.
  select coalesce(jsonb_agg(packet.value),'[]'::jsonb)
    into v_display_resource_packet
  from jsonb_array_elements(v_resource_packet) packet(value)
  where not exists(
    select 1 from atlas.resources r
    where r.id=nullif(packet.value->>'resourceId','')::uuid
      and coalesce(r.metadata->>'resource_role','')='reusable_energy_set'
  );

  with resource_consequence_rows as (
    select
      packet.value as requirement,
      consequence.value as consequence,
      coalesce((packet.value->>'requirementReady')::boolean,false) as requirement_ready,
      coalesce(packet.value->>'requirementRole','required') as requirement_role,
      nullif(packet.value->>'resourceId','')::uuid as resource_id
    from jsonb_array_elements(v_resource_packet) packet(value)
    cross join lateral jsonb_array_elements(coalesce(packet.value->'stateConsequences','[]'::jsonb)) consequence(value)
  ), seed_consequence_rows as (
    select
      jsonb_strip_nulls(jsonb_build_object(
        'seedLotId',sl.id,'seedLotKey',sl.stable_key,'seedLotLabel',sl.lot_label,
        'linkRole',stl.link_role,'seedReady',v_seed_ready
      )) as requirement,
      consequence.value as consequence,
      v_seed_ready as requirement_ready,
      'seed_input'::text as requirement_role,
      null::uuid as resource_id
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
        when subject_kind='resource'
          and resource_id is not null
          and atlas.resource_is_check_first_preparation_v1(resource_id)
          and consequence->>'policyKey'='resource-reusable-energy-unknown'
          then 'post_use_only'
        when requirement_role in ('required','seed_input') and not requirement_ready then 'blocking'
        else 'preparation'
      end as gate_class
    from consequence_rows
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('subjectKind',subject_kind,'requirement',requirement,'consequence',consequence)) filter(where gate_class='blocking'),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('subjectKind',subject_kind,'requirement',requirement,'consequence',consequence)) filter(where gate_class='preparation'),'[]'::jsonb),
    count(*) filter(where gate_class='blocking')::integer,
    count(*) filter(where gate_class='preparation')::integer
  into v_blocking,v_preparation,v_blocking_count,v_preparation_count
  from classified;

  return jsonb_build_object(
    'contractVersion','task_state_consequence_gate_v1','taskId',p_task_id,
    'state',case when v_blocking_count>0 then 'blocked' when v_preparation_count>0 then 'preparation_required' else 'clear' end,
    'blocking',(v_blocking_count>0),'preparationRequired',(v_preparation_count>0),
    'blockingCount',v_blocking_count,'preparationCount',v_preparation_count,
    'blockingConsequences',v_blocking,'preparationConsequences',v_preparation,
    'resourceRequirements',v_display_resource_packet,'seedReadiness',v_seed_readiness,
    'truthBoundary',jsonb_build_object(
      'stateConsequenceDoesNotReplaceDomainReadiness',true,
      'restockBelowPolicyDoesNotAutomaticallyBlockCurrentOperation',true,
      'checkFirstIsPreparationNotExecutionBlock',true,
      'reusableEnergyIsPostUseResetOnly',true,
      'legacyResourceStatusMayBlockWhenItIsTheBestAvailableCanonicalState',true
    )
  );
end;
$function$;