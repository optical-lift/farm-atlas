create table if not exists atlas.productization_surface_classifications (
  family_key text primary key,
  classification text not null check (classification in ('platform','domain_module','tenant_configuration','legacy')),
  function_name_pattern text,
  canonical_owner text not null,
  domain_key text,
  tenant_key text,
  portability_state text not null check (portability_state in ('portable','needs_generalization','tenant_bound','bounded_compatibility','retired')),
  authority_bearing boolean not null default false,
  rationale text not null,
  governing_source text not null default 'Atlas Whole-System Finish Build v1 - Productization Amendment',
  reviewed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check ((classification = 'domain_module') = (domain_key is not null)),
  check ((classification = 'tenant_configuration') = (tenant_key is not null))
);

alter table atlas.productization_surface_classifications enable row level security;
revoke all on table atlas.productization_surface_classifications from public, anon, authenticated;
grant select, insert, update, delete on table atlas.productization_surface_classifications to service_role;

insert into atlas.productization_surface_classifications
  (family_key, classification, function_name_pattern, canonical_owner, domain_key, tenant_key, portability_state, authority_bearing, rationale, metadata)
values
  ('principal_operating_system','platform','^principal_','principal',null,null,'portable',true,
   'Principal is a platform arbitration capability, not an Elm farm-owner dashboard.',
   jsonb_build_object('tranche',8)),
  ('worker_day','platform','^worker_(day|self)_','worker_day',null,null,'needs_generalization',true,
   'Worker Day is a platform execution surface. Current farm-scoped signatures are implementation debt, not grounds for a parallel replacement.',
   jsonb_build_object('tranche',3,'known_portability_debt','many signatures still accept p_farm_id')),
  ('worker_clock','platform','^farm_clock_','worker_clock',null,null,'needs_generalization',true,
   'Worker/Farm Clock is reusable execution-placement machinery; farm naming and scope must eventually generalize to operating-unit scope.',
   jsonb_build_object('tranche',6,'known_portability_debt','farm naming and p_farm_id scope')),
  ('knowledge_acquisition','platform','^(owner_needs_from_you|truth_acquisition_|requirement_)','knowledge_acquisition',null,null,'needs_generalization',true,
   'Knowledge acquisition is a reusable platform bridge from consequential missing truth to lawful acquisition and recomputation.',
   jsonb_build_object('tranche',1,'known_portability_debt','owner-prefixed presentation remains in active surface')),
  ('crop_lifecycle','domain_module','^crop_','farm_domain','farm',null,'portable',false,
   'Crop lifecycle is farm-domain behavior implemented on platform reality/requirement/result primitives.',
   jsonb_build_object('tranche',5)),
  ('harvest','domain_module','^harvest_','farm_domain','farm',null,'portable',false,
   'Harvest is farm/production-domain behavior and must not become a prerequisite for non-farm Atlas tenants.',
   jsonb_build_object('tranche',5)),
  ('grow_room','domain_module','^grow_room_','farm_domain','farm',null,'portable',false,
   'Grow Room is a farm-domain persistent world, not universal Atlas ontology.',
   jsonb_build_object('tranche',5)),
  ('owner_operator_compatibility','legacy','^owner_operator_','compatibility_boundary',null,null,'bounded_compatibility',false,
   'The owner_operator namespace is historical/compatibility surface. Individual functions may remain active until callers migrate, but it must not acquire new platform authority.',
   jsonb_build_object('retirement_rule','caller-census before removal'))
on conflict (family_key) do update set
  classification=excluded.classification,
  function_name_pattern=excluded.function_name_pattern,
  canonical_owner=excluded.canonical_owner,
  domain_key=excluded.domain_key,
  tenant_key=excluded.tenant_key,
  portability_state=excluded.portability_state,
  authority_bearing=excluded.authority_bearing,
  rationale=excluded.rationale,
  governing_source=excluded.governing_source,
  reviewed_at=now(),
  metadata=excluded.metadata;

create or replace function atlas.productization_surface_classification_audit_v1()
returns jsonb
language sql
security definer
set search_path = pg_catalog, atlas
as $$
with candidate_functions as (
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname ~ '^(principal_|worker_(day|self)_|farm_clock_|crop_|harvest_|grow_room_|owner_operator_|owner_needs_from_you|truth_acquisition_|requirement_)'
), matches as (
  select f.proname, c.family_key, c.classification, c.portability_state
  from candidate_functions f
  join atlas.productization_surface_classifications c
    on c.function_name_pattern is not null
   and f.proname ~ c.function_name_pattern
), rollup as (
  select
    (select count(*) from candidate_functions) as candidate_count,
    (select count(distinct proname) from matches) as classified_count,
    (select count(*) from (select proname from matches group by proname having count(*) > 1) x) as overlap_count,
    (select coalesce(jsonb_agg(proname order by proname),'[]'::jsonb)
       from candidate_functions f
      where not exists (select 1 from matches m where m.proname=f.proname)) as unclassified,
    (select coalesce(jsonb_agg(jsonb_build_object('family',family_key,'classification',classification,'portabilityState',portability_state,'functionCount',cnt) order by family_key),'[]'::jsonb)
       from (select family_key, classification, portability_state, count(distinct proname) cnt from matches group by 1,2,3) s) as families
)
select jsonb_build_object(
  'status', case when candidate_count=classified_count and overlap_count=0 then 'sound' else 'review_required' end,
  'candidateFunctionCount', candidate_count,
  'classifiedFunctionCount', classified_count,
  'overlapCount', overlap_count,
  'unclassifiedFunctions', unclassified,
  'families', families
)
from rollup;
$$;

revoke all on function atlas.productization_surface_classification_audit_v1() from public, anon, authenticated;
grant execute on function atlas.productization_surface_classification_audit_v1() to service_role;

insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected,
  service_execute_expected, caller_count, policy_reference_count,
  evidence, anonymous_execute_expected
)
values (
  'atlas.productization_surface_classification_audit_v1()',
  'service_internal','verified','revoked',false,true,true,0,0,
  jsonb_build_object('source','productization_surface_classification_v1','purpose','Tranche 0 productization classification audit; not application RPC'),false
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  anonymous_execute_expected=excluded.anonymous_execute_expected;
