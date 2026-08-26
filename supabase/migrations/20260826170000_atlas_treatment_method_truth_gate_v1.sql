-- A worker-executable treatment must carry an owner/management-confirmed method contract.
-- Missing method truth is not a harmless empty resource list: it blocks execution.

create or replace function atlas.task_treatment_method_readiness_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_template atlas.action_requirement_templates%rowtype;
  v_template_key text;
  v_missing_resource_keys text[] := '{}'::text[];
  v_has_treatment_material boolean := false;
  v_has_method_text boolean := false;
  v_method_confirmed boolean := false;
begin
  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id;

  if v_task.id is null then
    raise exception 'Task not found.' using errcode='P0002';
  end if;

  if coalesce(v_task.action_key,'') <> 'spray'
     or coalesce(v_task.operation_class,'') <> 'apply_treatment'
  then
    return jsonb_build_object(
      'contractVersion','task_treatment_method_readiness_v1',
      'taskId',p_task_id,
      'applicable',false,
      'ready',true,
      'state','not_applicable'
    );
  end if;

  v_template_key := nullif(btrim(coalesce(v_task.metadata->>'action_requirement_template_key','')),'');
  if v_template_key is null then
    return jsonb_build_object(
      'contractVersion','task_treatment_method_readiness_v1',
      'taskId',p_task_id,
      'applicable',true,
      'ready',false,
      'state','method_contract_missing',
      'missing',jsonb_build_array('action_requirement_template_key'),
      'truthBoundary',jsonb_build_object(
        'missingMethodBlocksExecution',true,
        'productMustNotBeInferred',true
      )
    );
  end if;

  select * into v_template
  from atlas.action_requirement_templates template
  where template.farm_id=v_task.farm_id
    and template.stable_key=v_template_key
  limit 1;

  if v_template.id is null then
    return jsonb_build_object(
      'contractVersion','task_treatment_method_readiness_v1',
      'taskId',p_task_id,
      'applicable',true,
      'ready',false,
      'state','method_contract_unresolved',
      'templateKey',v_template_key,
      'missing',jsonb_build_array('canonical_method_template')
    );
  end if;

  v_method_confirmed := coalesce((v_template.metadata->>'owner_authored')::boolean,false)
    or lower(coalesce(v_template.metadata->>'method_truth_status',''))='confirmed';

  if not v_method_confirmed then
    return jsonb_build_object(
      'contractVersion','task_treatment_method_readiness_v1',
      'taskId',p_task_id,
      'applicable',true,
      'ready',false,
      'state','method_truth_unconfirmed',
      'templateKey',v_template_key,
      'missing',jsonb_build_array('owner_or_management_confirmation')
    );
  end if;

  if coalesce(cardinality(v_template.required_resource_keys),0)=0 then
    return jsonb_build_object(
      'contractVersion','task_treatment_method_readiness_v1',
      'taskId',p_task_id,
      'applicable',true,
      'ready',false,
      'state','method_resources_missing',
      'templateKey',v_template_key,
      'missing',jsonb_build_array('required_resource_keys')
    );
  end if;

  select coalesce(array_agg(wanted.stable_key order by wanted.stable_key),'{}'::text[])
  into v_missing_resource_keys
  from unnest(v_template.required_resource_keys) wanted(stable_key)
  left join atlas.resources resource
    on resource.farm_id=v_task.farm_id
   and resource.stable_key=wanted.stable_key
  where resource.id is null;

  if coalesce(cardinality(v_missing_resource_keys),0)>0 then
    return jsonb_build_object(
      'contractVersion','task_treatment_method_readiness_v1',
      'taskId',p_task_id,
      'applicable',true,
      'ready',false,
      'state','method_resource_unresolved',
      'templateKey',v_template_key,
      'missingResourceKeys',to_jsonb(v_missing_resource_keys)
    );
  end if;

  select exists(
    select 1
    from atlas.resources resource
    where resource.farm_id=v_task.farm_id
      and resource.stable_key=any(v_template.required_resource_keys)
      and resource.resource_type not in ('equipment','tool','infrastructure','container')
  ) into v_has_treatment_material;

  if not v_has_treatment_material then
    return jsonb_build_object(
      'contractVersion','task_treatment_method_readiness_v1',
      'taskId',p_task_id,
      'applicable',true,
      'ready',false,
      'state','treatment_material_missing',
      'templateKey',v_template_key,
      'missing',jsonb_build_array('treatment_product_or_material')
    );
  end if;

  v_has_method_text := nullif(btrim(coalesce(v_template.notes,'')),'') is not null
    or nullif(btrim(coalesce(v_template.metadata->>'card_language','')),'') is not null
    or jsonb_array_length(
      case when jsonb_typeof(coalesce(v_template.metadata->'preparation_steps','[]'::jsonb))='array'
        then coalesce(v_template.metadata->'preparation_steps','[]'::jsonb)
        else '[]'::jsonb end
    ) > 0
    or jsonb_array_length(
      case when jsonb_typeof(coalesce(v_template.metadata->'coverage_steps','[]'::jsonb))='array'
        then coalesce(v_template.metadata->'coverage_steps','[]'::jsonb)
        else '[]'::jsonb end
    ) > 0;

  if not v_has_method_text then
    return jsonb_build_object(
      'contractVersion','task_treatment_method_readiness_v1',
      'taskId',p_task_id,
      'applicable',true,
      'ready',false,
      'state','method_instructions_missing',
      'templateKey',v_template_key,
      'missing',jsonb_build_array('application_or_preparation_instructions')
    );
  end if;

  return jsonb_build_object(
    'contractVersion','task_treatment_method_readiness_v1',
    'taskId',p_task_id,
    'applicable',true,
    'ready',true,
    'state','method_confirmed',
    'templateKey',v_template_key,
    'requiredResourceKeys',to_jsonb(v_template.required_resource_keys),
    'truthBoundary',jsonb_build_object(
      'methodAuthority','canonical_action_requirement_template',
      'productMustNotBeInferred',true,
      'unknownRequiredExecutionDataBlocksWorkerExecution',true
    )
  );
end;
$function$;

revoke all on function atlas.task_treatment_method_readiness_v1(uuid) from public;
grant execute on function atlas.task_treatment_method_readiness_v1(uuid) to service_role;

create or replace function atlas.task_execution_requirement_inputs_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_prereq boolean;
  v_resources boolean;
  v_destination jsonb;
  v_seed jsonb;
  v_method jsonb;
  v_method_ready boolean;
  v_state_gate jsonb;
  v_state_clear boolean;
begin
  if not exists(select 1 from atlas.tasks where id=p_task_id) then
    raise exception 'Task not found.' using errcode='P0002';
  end if;

  v_prereq:=atlas.task_prerequisites_ready_v1(p_task_id);
  v_resources:=atlas.task_required_resources_available_v1(p_task_id);
  v_destination:=atlas.task_execution_destination_readiness_v1(p_task_id);
  v_seed:=atlas.task_seed_readiness_v1(p_task_id);
  v_method:=atlas.task_treatment_method_readiness_v1(p_task_id);
  v_method_ready:=coalesce((v_method->>'ready')::boolean,false);
  v_state_gate:=atlas.task_state_consequence_gate_v1(p_task_id);
  v_state_clear:=not coalesce((v_state_gate->>'blocking')::boolean,false);

  return jsonb_build_array(
    jsonb_build_object(
      'requirementKey','prerequisites',
      'satisfied',v_prereq,
      'provider','task_prerequisites_ready_v1',
      'providerState',case when v_prereq then 'satisfied' else 'open' end,
      'evidence',jsonb_build_object('ready',v_prereq)
    ),
    jsonb_build_object(
      'requirementKey','resources',
      'satisfied',v_resources,
      'provider','task_required_resources_available_v1',
      'providerState',case when v_resources then 'satisfied' else 'open' end,
      'evidence',jsonb_build_object('ready',v_resources)
    ),
    jsonb_build_object(
      'requirementKey','destination',
      'satisfied',coalesce((v_destination->>'ready')::boolean,false),
      'provider','task_execution_destination_readiness_v1',
      'providerState',coalesce(v_destination->>'state','unknown'),
      'evidence',v_destination
    ),
    jsonb_build_object(
      'requirementKey','seed',
      'satisfied',coalesce((v_seed->>'ready')::boolean,false),
      'provider','task_seed_readiness_v1',
      'providerState',coalesce(v_seed->>'state','unknown'),
      'evidence',v_seed
    ),
    jsonb_build_object(
      'requirementKey','treatment_method',
      'satisfied',v_method_ready,
      'provider','task_treatment_method_readiness_v1',
      'providerState',coalesce(v_method->>'state','unknown'),
      'evidence',v_method
    ),
    jsonb_build_object(
      'requirementKey','state_consequence',
      'satisfied',v_state_clear,
      'provider','task_state_consequence_gate_v1',
      'providerState',coalesce(v_state_gate->>'state','unknown'),
      'evidence',v_state_gate
    )
  );
end;
$function$;

create or replace function atlas.task_execution_readiness_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_canonical jsonb;
  v_requirements jsonb;
  v_ready boolean := false;
  v_prereq boolean := false;
  v_resources boolean := false;
  v_destination_ready boolean := false;
  v_seed_ready boolean := false;
  v_method_ready boolean := false;
  v_state_gate_clear boolean := false;
  v_destination jsonb := '{}'::jsonb;
  v_seed jsonb := '{}'::jsonb;
  v_method jsonb := '{}'::jsonb;
  v_state_gate jsonb := '{}'::jsonb;
begin
  v_canonical := atlas.task_execution_requirement_evaluation_v1(p_task_id);
  v_requirements := coalesce(v_canonical->'requirements', '[]'::jsonb);
  v_ready := coalesce((v_canonical->>'executionReady')::boolean, false);

  select coalesce((node->>'satisfied')::boolean, false)
  into v_prereq
  from jsonb_array_elements(v_requirements) node
  where node->>'requirementKey' = 'prerequisites'
  limit 1;

  select coalesce((node->>'satisfied')::boolean, false)
  into v_resources
  from jsonb_array_elements(v_requirements) node
  where node->>'requirementKey' = 'resources'
  limit 1;

  select coalesce((node->>'satisfied')::boolean, false), coalesce(node->'evidence','{}'::jsonb)
  into v_destination_ready, v_destination
  from jsonb_array_elements(v_requirements) node
  where node->>'requirementKey' = 'destination'
  limit 1;

  select coalesce((node->>'satisfied')::boolean, false), coalesce(node->'evidence','{}'::jsonb)
  into v_seed_ready, v_seed
  from jsonb_array_elements(v_requirements) node
  where node->>'requirementKey' = 'seed'
  limit 1;

  select coalesce((node->>'satisfied')::boolean, false), coalesce(node->'evidence','{}'::jsonb)
  into v_method_ready, v_method
  from jsonb_array_elements(v_requirements) node
  where node->>'requirementKey' = 'treatment_method'
  limit 1;

  select coalesce((node->>'satisfied')::boolean, false), coalesce(node->'evidence','{}'::jsonb)
  into v_state_gate_clear, v_state_gate
  from jsonb_array_elements(v_requirements) node
  where node->>'requirementKey' = 'state_consequence'
  limit 1;

  v_prereq := coalesce(v_prereq, false);
  v_resources := coalesce(v_resources, false);
  v_destination_ready := coalesce(v_destination_ready, false);
  v_seed_ready := coalesce(v_seed_ready, false);
  v_method_ready := coalesce(v_method_ready, false);
  v_state_gate_clear := coalesce(v_state_gate_clear, false);
  v_destination := coalesce(v_destination, '{}'::jsonb);
  v_seed := coalesce(v_seed, '{}'::jsonb);
  v_method := coalesce(v_method, '{}'::jsonb);
  v_state_gate := coalesce(v_state_gate, '{}'::jsonb);

  return jsonb_build_object(
    'contractVersion','task_execution_warrant_v1',
    'contractRole','execution_warrant',
    'taskId',p_task_id,
    'ready',v_ready,
    'executionReady',v_ready,
    'prerequisitesReady',v_prereq,
    'resourcesReady',v_resources,
    'destinationReady',v_destination_ready,
    'seedReady',v_seed_ready,
    'treatmentMethodReady',v_method_ready,
    'preparationRequired',coalesce((v_state_gate->>'preparationRequired')::boolean,false),
    'destination',v_destination,
    'seed',v_seed,
    'treatmentMethod',v_method,
    'stateConsequenceGate',v_state_gate,
    'stateConsequenceClear',v_state_gate_clear,
    'truthBoundary',jsonb_build_object(
      'requirementAuthority',false,
      'compatibilityProjection',true,
      'canonicalEvaluation','task_execution_requirement_evaluation_v1',
      'requirementExistenceNotInferredFromReady',true,
      'notReadyDoesNotMeanNotRequired',true,
      'thisContractOnlyAnswersWhetherRepresentedTaskMayExecuteNow',true
    )
  );
end;
$function$;

-- Record the owner-confirmed reusable sprayer itself. The treatment product is
-- deliberately NOT invented here; the BB10 method remains blocked until that
-- material identity is canonically confirmed.
insert into atlas.resources (
  farm_id, stable_key, label, resource_type, resource_category, status,
  quantity, unit, condition_notes, consumable, borrow_or_owner, metadata
)
select
  farm.id,
  'black_jug_electric_sprayer',
  'Black Jug Electric Sprayer',
  'equipment',
  'weed_control',
  'available',
  1,
  'sprayer',
  'Black jug with electric sprayer attachment; powered by 3 AA batteries.',
  false,
  'elm',
  jsonb_build_object(
    'source','owner_instruction_20260823_recovered_20260826',
    'sprayer_attachment','electric',
    'battery_type','AA',
    'battery_count',3,
    'owner_confirmed',true
  )
from atlas.farms farm
where farm.stable_key='elm_farm'
on conflict (farm_id, stable_key) do update set
  label=excluded.label,
  resource_type=excluded.resource_type,
  resource_category=excluded.resource_category,
  status=excluded.status,
  quantity=excluded.quantity,
  unit=excluded.unit,
  condition_notes=excluded.condition_notes,
  consumable=excluded.consumable,
  borrow_or_owner=excluded.borrow_or_owner,
  metadata=atlas.resources.metadata || excluded.metadata,
  updated_at=now();

with elm as (
  select id from atlas.farms where stable_key='elm_farm'
), bb10 as (
  select task.id, task.metadata
  from atlas.tasks task
  join elm on elm.id=task.farm_id
  where task.metadata->>'task_key'=any(array[
    'anna_20260824_spray_bb10_bermuda_pass_1_restart',
    'anna_20260903_spray_bb10_bermuda_pass_2',
    'anna_20260914_spray_bb10_bermuda_pass_3'
  ])
)
update atlas.tasks task
set metadata = task.metadata || jsonb_build_object(
      'worker_method_required',true,
      'owner_definition_required',true,
      'worker_packet_hold',true,
      'worker_packet_hold_reason','Treatment product identity is not canonically recorded.',
      'required_resource_keys',
        case
          when jsonb_typeof(coalesce(task.metadata->'required_resource_keys','[]'::jsonb))='array'
            and not coalesce(task.metadata->'required_resource_keys','[]'::jsonb) @> '["black_jug_electric_sprayer"]'::jsonb
          then coalesce(task.metadata->'required_resource_keys','[]'::jsonb) || '["black_jug_electric_sprayer"]'::jsonb
          when jsonb_typeof(coalesce(task.metadata->'required_resource_keys','[]'::jsonb))='array'
          then coalesce(task.metadata->'required_resource_keys','[]'::jsonb)
          else '["black_jug_electric_sprayer"]'::jsonb
        end,
      'recovered_treatment_method',jsonb_build_object(
        'source','owner_instruction_20260823_recovered_20260826',
        'sprayer_resource_key','black_jug_electric_sprayer',
        'refill','2/3 cup concentrate to 1 gallon water',
        'concentrate_cups_per_gallon',0.6666666667,
        'application_target','leaf contact; not root application',
        'owner_method_note','Kills on leaf contact, not root.',
        'dieback_window_days',jsonb_build_array(5,7),
        'product_identity_state','owner_input_required'
      )
    ),
    updated_at=now()
from bb10
where task.id=bb10.id;

insert into atlas.task_resource_requirements (
  task_id, resource_id, requirement_role, requirement_source, quantity_needed,
  unit, status, note, metadata, move_role
)
select
  task.id,
  resource.id,
  'required',
  'manual',
  1,
  'sprayer',
  'available',
  'Owner-confirmed application equipment for this treatment sequence.',
  jsonb_build_object(
    'source','owner_instruction_20260823_recovered_20260826',
    'resource_key','black_jug_electric_sprayer'
  ),
  'equipment'
from atlas.tasks task
join atlas.farms farm on farm.id=task.farm_id and farm.stable_key='elm_farm'
join atlas.resources resource on resource.farm_id=farm.id and resource.stable_key='black_jug_electric_sprayer'
where task.metadata->>'task_key'=any(array[
  'anna_20260824_spray_bb10_bermuda_pass_1_restart',
  'anna_20260903_spray_bb10_bermuda_pass_2',
  'anna_20260914_spray_bb10_bermuda_pass_3'
])
and not exists (
  select 1
  from atlas.task_resource_requirements existing
  where existing.task_id=task.id
    and existing.resource_id=resource.id
    and existing.requirement_role='required'
);
