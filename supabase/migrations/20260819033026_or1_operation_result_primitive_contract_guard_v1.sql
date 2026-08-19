create or replace function atlas.operation_result_primitive_contract_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with primitives(object_ref, object_kind, shared_roles, domain_owner, current_gap, disposition) as (
  values
    ('atlas.resources'::text,'relation'::text,array['REQUIRES','USES']::text[],'generic_resources'::text,'Legacy resource status remains subordinate to stronger domain/resource operational state when one exists.'::text,'EXTEND'::text),
    ('atlas.task_resource_requirements','relation',array['REQUIRES','USES']::text[],'farm_execution','Requirement declaration is not itself proof that the resource is ready.','KEEP'),
    ('atlas.action_requirement_templates','relation',array['REQUIRES']::text[],'farm_execution','Template declaration must resolve against current reality before execution.','KEEP'),
    ('atlas.task_prerequisites','relation',array['REQUIRES']::text[],'farm_execution','Use only when a specific upstream task result is the governing condition; do not encode state gates or affinity here.','KEEP'),
    ('atlas.task_dependency_clocks','relation',array['REQUIRES','TRIGGERS']::text[],'farm_clock','Timing/dependency clocks must not become a substitute for current state/resource readiness.','KEEP'),
    ('atlas.task_completion_impact_policies','relation',array['CHANGES','TRIGGERS']::text[],'farm_execution','Impact policy may describe consequence but canonical state must be established through lawful domain/resource events.','EXTEND'),
    ('atlas.task_outcome_events','relation',array['MEASURES','CHANGES']::text[],'farm_execution','Outcome evidence is witness material; it does not by itself establish every downstream domain state.','KEEP'),
    ('atlas.task_transitions','relation',array['CHANGES']::text[],'farm_execution','Task status transition is not the canonical transformation of the affected real subject.','KEEP'),
    ('atlas.workflow_events','relation',array['CHANGES','TRIGGERS']::text[],'workflow','Workflow events coordinate execution but cannot replace stronger domain events.','KEEP'),
    ('atlas.workflow_handoffs','relation',array['TRIGGERS']::text[],'workflow','Handoff is continuation/routing, not scheduling affinity and not proof of downstream readiness.','KEEP'),
    ('atlas.work_gate_evaluations','relation',array['REQUIRES']::text[],'farm_execution','Gate evaluation consumes current truth; it must not manufacture truth to satisfy scheduling.','KEEP'),
    ('atlas.task_release_queue_items','relation',array['TRIGGERS']::text[],'farm_clock','Release queue is a projection/continuation surface and must not be treated as source truth.','KEEP'),
    ('atlas.seed_lots','relation',array['REQUIRES','CONSUMES']::text[],'seed_inventory','Seed identity remains seed-domain truth rather than generic inventory.','KEEP'),
    ('atlas.seed_lot_allocations','relation',array['REQUIRES']::text[],'seed_inventory','Allocation reserves/relates seed but does not prove actual consumption.','KEEP'),
    ('atlas.seed_allocation_consumptions','relation',array['CONSUMES','MEASURES']::text[],'seed_inventory','Consumption must remain attributable to the actual operation/result witness.','KEEP'),
    ('atlas.seed_inventory_events','relation',array['CONSUMES','PRODUCES','MEASURES','CHANGES']::text[],'seed_inventory','Event ledger remains canonical for seed quantity/state changes.','KEEP'),
    ('atlas.seed_inventory_state','relation',array['REQUIRES','CHANGES']::text[],'seed_inventory','Projected state must preserve unknown quantity rather than fabricating availability or zero.','KEEP'),
    ('atlas.seed_lot_task_links','relation',array['REQUIRES']::text[],'seed_inventory','Task link establishes relationship, not sufficient quantity/readiness.','KEEP'),
    ('atlas.crop_harvest_events','relation',array['MEASURES','PRODUCES','CHANGES']::text[],'harvest','Harvest event must stay attached to the actual standing source/crop lineage.','KEEP'),
    ('atlas.crop_harvest_availability','relation',array['REQUIRES','CHANGES']::text[],'harvest','Availability is biological/domain state and cannot be inferred from task completion alone.','KEEP'),
    ('atlas.flower_harvest_batches','relation',array['PRODUCES','MEASURES']::text[],'harvest','Harvested physical output is not yet Ready saleable inventory.','KEEP'),
    ('atlas.flower_harvest_bucket_observations','relation',array['MEASURES']::text[],'harvest','Observation is evidence at the domain-appropriate field unit.','KEEP'),
    ('atlas.flower_preparation_batches','relation',array['PRODUCES','CHANGES']::text[],'harvest','Preparation transforms harvested output but must preserve lineage.','KEEP'),
    ('atlas.flower_ready_inventory_lots','relation',array['PRODUCES','REQUIRES']::text[],'harvest','Ready inventory is downstream physical/commercial truth, not synonymous with harvested output.','KEEP'),
    ('atlas.resource_events','relation',array['CONSUMES','PRODUCES','MEASURES','CHANGES']::text[],'generic_resources','Generic resource events apply only where no stronger domain ledger governs the resource.','KEEP'),
    ('atlas.resource_operational_state','relation',array['REQUIRES','CHANGES']::text[],'generic_resources','Unknown readiness remains unknown until witnessed; reusable-resource reset state survives task completion.','KEEP'),
    ('atlas.state_consequence_policies','relation',array['TRIGGERS']::text[],'shared_consequence_engine','Consequences are released from resulting state, not hard-coded task-A-creates-task-B semantics.','KEEP'),
    ('atlas.state_consequence_instances','relation',array['TRIGGERS']::text[],'shared_consequence_engine','Consequence instances must be idempotent per governed state/generation.','KEEP'),
    ('atlas.mowing_travel_affinity_v1(uuid)','routine',array['TRAVELS_WITH']::text[],'maintenance','Affinity must never be stored or interpreted as prerequisite completion.','KEEP'),
    ('atlas.apply_mowing_resource_effect_v1(uuid,uuid,uuid)','routine',array['CONSUMES','CHANGES','TRIGGERS']::text[],'maintenance','Mowing completion may finish the operation while leaving battery reset consequence unresolved.','KEEP'),
    ('atlas.task_state_consequence_gate_v1(uuid)','routine',array['REQUIRES','TRIGGERS']::text[],'shared_consequence_engine','Gate consumes resulting state and consequence truth; it does not manufacture readiness.','KEEP'),
    ('atlas.worker_next_up_v3(uuid,uuid,date)','routine',array['REQUIRES','TRAVELS_WITH','TRIGGERS']::text[],'worker_day','Next Up is a consumer of current readiness/gates/affinity, never a source of those truths.','KEEP'),
    ('atlas.worker_day_state_transition_cards_v2(uuid,uuid,date)','routine',array['MEASURES','CHANGES','TRIGGERS']::text[],'worker_day','Worker UI asks only for missing witness evidence and carries resulting continuation forward.','KEEP')
), checked as (
  select object_ref, object_kind, shared_roles, domain_owner, current_gap, disposition,
         case when object_kind='relation'
              then pg_catalog.to_regclass(object_ref) is not null
              else pg_catalog.to_regprocedure(object_ref) is not null
         end as present
  from primitives
)
select pg_catalog.jsonb_build_object(
  'contractVersion','operation_result_primitive_contract_v1',
  'governingSubsystem','Operation -> Result -> State Transition',
  'sharedVocabulary',pg_catalog.jsonb_build_array('REQUIRES','USES','CONSUMES','PRODUCES','MEASURES','CHANGES','TRIGGERS','TRAVELS_WITH'),
  'mappingCount',count(*),
  'primitives',pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'objectRef',object_ref,
        'objectKind',object_kind,
        'sharedRoles',pg_catalog.to_jsonb(shared_roles),
        'domainOwner',domain_owner,
        'currentGap',current_gap,
        'disposition',disposition,
        'present',present
      ) order by object_ref
  ),
  'truthBoundary',pg_catalog.jsonb_build_object(
    'taskCompletionIsNotReality',true,
    'domainTruthRemainsDifferentiated',true,
    'stateGateIsNotTaskPrerequisite',true,
    'completionConsequenceIsNotTaskCompletion',true,
    'schedulingAffinityIsNotDependency',true,
    'unknownIsNotZeroOrReady',true,
    'clockConsumesRealityRatherThanManufacturingReadiness',true,
    'principalReceivesOnlyTrueOwnershipEscalations',true
  )
)
from checked;
$function$;

create or replace function atlas.operation_result_primitive_contract_audit_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with contract as (
  select atlas.operation_result_primitive_contract_v1() as j
), primitive_rows as (
  select value as p
  from contract, pg_catalog.jsonb_array_elements(j->'primitives')
), missing as (
  select coalesce(pg_catalog.jsonb_agg(p->>'objectRef' order by p->>'objectRef'),'[]'::jsonb) as items,
         count(*)::integer as n
  from primitive_rows
  where coalesce((p->>'present')::boolean,false)=false
), vocab(role) as (
  values ('REQUIRES'::text),('USES'),('CONSUMES'),('PRODUCES'),('MEASURES'),('CHANGES'),('TRIGGERS'),('TRAVELS_WITH')
), coverage as (
  select v.role,
         exists(select 1 from primitive_rows r where (r.p->'sharedRoles') ? v.role) as covered
  from vocab v
), uncovered as (
  select coalesce(pg_catalog.jsonb_agg(role order by role) filter(where not covered),'[]'::jsonb) as items,
         count(*) filter(where not covered)::integer as n
  from coverage
), invalid_disposition as (
  select coalesce(pg_catalog.jsonb_agg(p->>'objectRef' order by p->>'objectRef'),'[]'::jsonb) as items,
         count(*)::integer as n
  from primitive_rows
  where p->>'disposition' not in ('KEEP','EXTEND','DEPRECATE','REMOVE LATER')
)
select pg_catalog.jsonb_build_object(
  'contractVersion','operation_result_primitive_contract_audit_v1',
  'state',case when m.n=0 and u.n=0 and d.n=0 then 'or1_contract_sound' else 'or1_contract_gap' end,
  'mappingCount',(c.j->>'mappingCount')::integer,
  'missingPrimitiveCount',m.n,
  'missingPrimitives',m.items,
  'uncoveredVocabularyCount',u.n,
  'uncoveredVocabulary',u.items,
  'invalidDispositionCount',d.n,
  'invalidDispositions',d.items,
  'truthBoundary',pg_catalog.jsonb_build_object(
    'guardMapsExistingMachineryRatherThanRebuildingIt',true,
    'presenceDoesNotProveSemanticCorrectnessWithoutOr8',true,
    'or1AndOr8AreComplementary',true
  )
)
from contract c cross join missing m cross join uncovered u cross join invalid_disposition d;
$function$;

revoke all on function atlas.operation_result_primitive_contract_v1() from public, anon, authenticated;
revoke all on function atlas.operation_result_primitive_contract_audit_v1() from public, anon, authenticated;
grant execute on function atlas.operation_result_primitive_contract_v1() to service_role;
grant execute on function atlas.operation_result_primitive_contract_audit_v1() to service_role;

comment on function atlas.operation_result_primitive_contract_v1() is 'OR1 constitutional map of existing Atlas primitives into the shared Operation -> Result -> State Transition vocabulary. Read-only; does not replace domain truth.';
comment on function atlas.operation_result_primitive_contract_audit_v1() is 'OR1 architecture guard: verifies required mapped primitives exist and all eight shared relationship roles remain represented.';