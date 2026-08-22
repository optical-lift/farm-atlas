create table if not exists local_intel.source_reliability_claim_families (
  stable_key text primary key,
  label text not null,
  description text not null,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into local_intel.source_reliability_claim_families(stable_key,label,description)
values
  ('identity','Identity','Names, aliases, legal or public identity, and entity identity surfaces.'),
  ('contact','Contact','Phone, email, website, addressable contact routes, and contact validity.'),
  ('location','Location','Physical location, service geography, branches, and place claims.'),
  ('leadership','Leadership','Public roles, leadership assignments, titles, and authority-bearing people.'),
  ('workforce','Workforce','Headcount, staffing scale, employment counts, and workforce composition.'),
  ('offerings','Offerings','Products, services, programs, capabilities, and what an organization offers.'),
  ('pricing','Pricing','Prices, fees, free/paid status, packages, and transaction terms.'),
  ('availability','Availability','Current availability, openings, capacity, schedules, and whether an offer is live.'),
  ('events','Events','Event existence, dates, cadence, venue, audience, and occurrence facts.'),
  ('relationships','Relationships','Employment, affiliation, ownership, brand use, membership, and other entity relationships.'),
  ('other','Other','Governed fallback for claim kinds that do not yet have a more specific family.')
on conflict (stable_key) do update
set label=excluded.label, description=excluded.description, updated_at=now();

create table if not exists local_intel.source_reliability_claim_kind_map (
  claim_kind text primary key,
  claim_family_key text not null references local_intel.source_reliability_claim_families(stable_key) on delete restrict,
  rationale text not null,
  mapping_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into local_intel.source_reliability_claim_kind_map(claim_kind,claim_family_key,rationale,mapping_version)
values
  ('public_role_title','leadership','A public role title is leadership/role evidence, not generic identity evidence.','1.0'),
  ('workforce_headcount','workforce','Headcount is a workforce-scale claim.','1.0')
on conflict (claim_kind) do update
set claim_family_key=excluded.claim_family_key, rationale=excluded.rationale, mapping_version=excluded.mapping_version, updated_at=now();

create table if not exists local_intel.source_reliability_assessments (
  id uuid primary key default gen_random_uuid(),
  assessment_key text not null unique,
  source_id uuid not null references local_intel.sources(id) on delete restrict,
  source_class_id_snapshot uuid references local_intel.research_source_classes(id) on delete restrict,
  claim_id uuid not null references local_intel.entity_claims(id) on delete restrict,
  claim_kind_snapshot text not null,
  claim_family_key text not null references local_intel.source_reliability_claim_families(stable_key) on delete restrict,
  subject_party_relationship text not null,
  assessment_dimension text not null check (assessment_dimension in ('accuracy','currency','completeness')),
  outcome_label text not null check (outcome_label in ('confirmed','contradicted','current','stale','complete','incomplete','partial')),
  outcome_score numeric not null check (outcome_score >= 0 and outcome_score <= 1),
  basis_kind text not null check (basis_kind in ('independent_source','later_first_party_state','human_adjudication','real_world_outcome','canonical_reconciliation')),
  independent_evidence_source_id uuid references local_intel.sources(id) on delete restrict,
  independence_state text not null check (independence_state in ('independent','same_publisher','not_applicable','unknown')),
  assessment_method text not null,
  algorithm_version text not null,
  evidence_note text,
  metadata jsonb not null default '{}'::jsonb,
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (independent_evidence_source_id is null or independent_evidence_source_id <> source_id)
);

create index if not exists source_reliability_assessments_source_family_idx
  on local_intel.source_reliability_assessments(source_id,claim_family_key,subject_party_relationship,assessment_dimension,assessed_at desc);
create index if not exists source_reliability_assessments_class_family_idx
  on local_intel.source_reliability_assessments(source_class_id_snapshot,claim_family_key,subject_party_relationship,assessment_dimension,assessed_at desc);

create or replace function local_intel.block_source_reliability_assessment_mutation_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','local_intel'
as $function$
begin
  raise exception 'source_reliability_assessments is append-only';
end;
$function$;

drop trigger if exists source_reliability_assessments_append_only_v1 on local_intel.source_reliability_assessments;
create trigger source_reliability_assessments_append_only_v1
before update or delete on local_intel.source_reliability_assessments
for each row execute function local_intel.block_source_reliability_assessment_mutation_v1();

create or replace function local_intel.record_source_reliability_assessment_v1(
  p_assessment_key text,
  p_source_id uuid,
  p_claim_id uuid,
  p_assessment_dimension text,
  p_outcome_label text,
  p_outcome_score numeric,
  p_basis_kind text,
  p_independent_evidence_source_id uuid default null,
  p_independence_state text default 'unknown',
  p_assessment_method text default 'governed_reliability_assessment',
  p_algorithm_version text default '1.0',
  p_evidence_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  v_claim_kind text;
  v_family text;
  v_source_class_id uuid;
  v_party_relationship text;
  v_id uuid;
begin
  if p_assessment_key is null or btrim(p_assessment_key)='' then
    raise exception 'assessment_key is required';
  end if;

  if not exists (
    select 1 from local_intel.claim_sources cs
    where cs.claim_id=p_claim_id and cs.source_id=p_source_id
  ) then
    raise exception 'Source % is not linked to claim % and cannot be graded for that claim', p_source_id, p_claim_id;
  end if;

  select ec.claim_kind into v_claim_kind
  from local_intel.entity_claims ec where ec.id=p_claim_id;

  select m.claim_family_key into v_family
  from local_intel.source_reliability_claim_kind_map m
  where m.claim_kind=v_claim_kind;

  if v_family is null then
    raise exception 'Claim kind % has no governed source-reliability family mapping', v_claim_kind;
  end if;

  select sca.source_class_id, coalesce(nullif(cs.metadata->>'subject_party_relationship',''),rsc.default_subject_party_relationship,'unknown')
  into v_source_class_id, v_party_relationship
  from local_intel.claim_sources cs
  left join local_intel.source_class_assignments sca on sca.source_id=cs.source_id and sca.assignment_state='classified'
  left join local_intel.research_source_classes rsc on rsc.id=sca.source_class_id
  where cs.claim_id=p_claim_id and cs.source_id=p_source_id
  order by cs.created_at desc
  limit 1;

  if p_basis_kind='independent_source' and p_independent_evidence_source_id is null then
    raise exception 'independent_source basis requires independent_evidence_source_id';
  end if;

  if p_independent_evidence_source_id=p_source_id then
    raise exception 'A source cannot independently confirm itself';
  end if;

  insert into local_intel.source_reliability_assessments(
    assessment_key,source_id,source_class_id_snapshot,claim_id,claim_kind_snapshot,claim_family_key,
    subject_party_relationship,assessment_dimension,outcome_label,outcome_score,basis_kind,
    independent_evidence_source_id,independence_state,assessment_method,algorithm_version,evidence_note,metadata
  ) values (
    p_assessment_key,p_source_id,v_source_class_id,p_claim_id,v_claim_kind,v_family,
    v_party_relationship,p_assessment_dimension,p_outcome_label,p_outcome_score,p_basis_kind,
    p_independent_evidence_source_id,p_independence_state,p_assessment_method,p_algorithm_version,p_evidence_note,coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict (assessment_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from local_intel.source_reliability_assessments where assessment_key=p_assessment_key;
  end if;
  return v_id;
end;
$function$;

create or replace view local_intel.v_source_reliability_profile_v1 as
select
  a.source_id,
  s.publisher,
  s.source_kind,
  a.claim_family_key,
  a.subject_party_relationship,
  a.assessment_dimension,
  count(*)::bigint as assessment_count,
  count(*) filter (where a.independence_state='independent' or a.basis_kind in ('human_adjudication','real_world_outcome','later_first_party_state'))::bigint as strong_assessment_count,
  avg(a.outcome_score)::numeric(8,5) as observed_mean_score,
  ((2::numeric + sum(a.outcome_score)) / (4::numeric + count(*)))::numeric(8,5) as posterior_reliability_score,
  min(a.assessed_at) as first_assessed_at,
  max(a.assessed_at) as last_assessed_at,
  case
    when count(*) < 5 then 'insufficient_sample'
    when count(*) < 15 then 'emerging'
    else 'established'
  end as learning_state,
  (count(*) >= 5 and count(*) filter (where a.independence_state='independent' or a.basis_kind in ('human_adjudication','real_world_outcome','later_first_party_state')) >= 3) as eligible_for_confidence_adjustment
from local_intel.source_reliability_assessments a
join local_intel.sources s on s.id=a.source_id
group by a.source_id,s.publisher,s.source_kind,a.claim_family_key,a.subject_party_relationship,a.assessment_dimension;

create or replace view local_intel.v_source_class_reliability_profile_v1 as
select
  a.source_class_id_snapshot as source_class_id,
  rsc.stable_key as source_class_key,
  a.claim_family_key,
  a.subject_party_relationship,
  a.assessment_dimension,
  count(*)::bigint as assessment_count,
  count(distinct a.source_id)::bigint as contributing_source_count,
  avg(a.outcome_score)::numeric(8,5) as observed_mean_score,
  ((2::numeric + sum(a.outcome_score)) / (4::numeric + count(*)))::numeric(8,5) as posterior_reliability_score,
  case
    when count(*) < 10 or count(distinct a.source_id) < 3 then 'insufficient_sample'
    when count(*) < 30 or count(distinct a.source_id) < 5 then 'emerging'
    else 'established'
  end as learning_state
from local_intel.source_reliability_assessments a
left join local_intel.research_source_classes rsc on rsc.id=a.source_class_id_snapshot
group by a.source_class_id_snapshot,rsc.stable_key,a.claim_family_key,a.subject_party_relationship,a.assessment_dimension;

create or replace view local_intel.v_source_reliability_learning_queue_v1 as
with evidence as (
  select
    ec.id as claim_id,
    ec.subject_entity_id,
    ec.claim_kind,
    m.claim_family_key,
    ec.adjudication_state,
    ec.conflict_state,
    count(distinct cs.source_id) as source_count,
    array_agg(distinct cs.source_id) as source_ids
  from local_intel.entity_claims ec
  join local_intel.claim_sources cs on cs.claim_id=ec.id
  left join local_intel.source_reliability_claim_kind_map m on m.claim_kind=ec.claim_kind
  group by ec.id,m.claim_family_key
)
select
  e.*,
  case
    when e.claim_family_key is null then 'map_claim_family'
    when e.conflict_state is distinct from 'none' then 'adjudicate_conflict_then_grade_sources'
    when e.source_count >= 2 then 'independent_corroboration_candidate'
    else 'await_independent_evidence'
  end as next_learning_step
from evidence e
where e.claim_family_key is null
   or e.conflict_state is distinct from 'none'
   or e.source_count >= 2;

revoke all on local_intel.source_reliability_claim_families from public, anon, authenticated;
revoke all on local_intel.source_reliability_claim_kind_map from public, anon, authenticated;
revoke all on local_intel.source_reliability_assessments from public, anon, authenticated;
revoke all on local_intel.v_source_reliability_profile_v1 from public, anon, authenticated;
revoke all on local_intel.v_source_class_reliability_profile_v1 from public, anon, authenticated;
revoke all on local_intel.v_source_reliability_learning_queue_v1 from public, anon, authenticated;
revoke execute on function local_intel.block_source_reliability_assessment_mutation_v1() from public, anon, authenticated;
revoke execute on function local_intel.record_source_reliability_assessment_v1(text,uuid,uuid,text,text,numeric,text,uuid,text,text,text,text,jsonb) from public, anon, authenticated;
grant select,insert,update,delete on local_intel.source_reliability_claim_families to service_role;
grant select,insert,update,delete on local_intel.source_reliability_claim_kind_map to service_role;
grant select,insert on local_intel.source_reliability_assessments to service_role;
grant select on local_intel.v_source_reliability_profile_v1, local_intel.v_source_class_reliability_profile_v1, local_intel.v_source_reliability_learning_queue_v1 to service_role;
grant execute on function local_intel.record_source_reliability_assessment_v1(text,uuid,uuid,text,text,numeric,text,uuid,text,text,text,text,jsonb) to service_role;