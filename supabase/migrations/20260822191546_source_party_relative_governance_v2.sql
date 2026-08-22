alter table local_intel.research_source_classes
  add column if not exists publisher_authority text not null default 'unknown',
  add column if not exists default_subject_party_relationship text not null default 'unknown';

alter table local_intel.research_source_classes
  drop constraint if exists research_source_classes_publisher_authority_check;
alter table local_intel.research_source_classes
  add constraint research_source_classes_publisher_authority_check
  check (publisher_authority in ('internal','statutory_authority','organization_official','institutional_official','commercial_editorial','platform','public_self_reported','unknown'));

alter table local_intel.research_source_classes
  drop constraint if exists research_source_classes_default_subject_party_relationship_check;
alter table local_intel.research_source_classes
  add constraint research_source_classes_default_subject_party_relationship_check
  check (default_subject_party_relationship in ('internal','first_party','authoritative_third_party','third_party','context_dependent','unknown'));

update local_intel.research_source_classes
set publisher_authority = case stable_key
      when 'internal_governance' then 'internal'
      when 'primary_authority' then 'statutory_authority'
      when 'direct_provider' then 'organization_official'
      when 'first_party_official' then 'organization_official'
      when 'credentialed_directory' then 'institutional_official'
      when 'transaction_platform' then 'platform'
      when 'current_directory' then 'commercial_editorial'
      when 'reputable_secondary' then 'commercial_editorial'
      when 'public_social' then 'public_self_reported'
      when 'discovery_only' then 'unknown'
      else publisher_authority end,
    default_subject_party_relationship = case stable_key
      when 'internal_governance' then 'internal'
      when 'primary_authority' then 'authoritative_third_party'
      when 'direct_provider' then 'first_party'
      when 'first_party_official' then 'first_party'
      when 'credentialed_directory' then 'authoritative_third_party'
      when 'transaction_platform' then 'third_party'
      when 'current_directory' then 'third_party'
      when 'reputable_secondary' then 'third_party'
      when 'public_social' then 'context_dependent'
      when 'discovery_only' then 'third_party'
      else default_subject_party_relationship end,
    semantics = coalesce(semantics,'{}'::jsonb) || jsonb_build_object(
      'publisher_authority', case stable_key
        when 'internal_governance' then 'internal'
        when 'primary_authority' then 'statutory_authority'
        when 'direct_provider' then 'organization_official'
        when 'first_party_official' then 'organization_official'
        when 'credentialed_directory' then 'institutional_official'
        when 'transaction_platform' then 'platform'
        when 'current_directory' then 'commercial_editorial'
        when 'reputable_secondary' then 'commercial_editorial'
        when 'public_social' then 'public_self_reported'
        when 'discovery_only' then 'unknown'
        else publisher_authority end,
      'default_subject_party_relationship', case stable_key
        when 'internal_governance' then 'internal'
        when 'primary_authority' then 'authoritative_third_party'
        when 'direct_provider' then 'first_party'
        when 'first_party_official' then 'first_party'
        when 'credentialed_directory' then 'authoritative_third_party'
        when 'transaction_platform' then 'third_party'
        when 'current_directory' then 'third_party'
        when 'reputable_secondary' then 'third_party'
        when 'public_social' then 'context_dependent'
        when 'discovery_only' then 'third_party'
        else default_subject_party_relationship end
    ),
    updated_at = now();

create table if not exists local_intel.source_class_assignment_history (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references local_intel.sources(id) on delete restrict,
  previous_source_class_id uuid references local_intel.research_source_classes(id) on delete restrict,
  previous_assignment_state text not null,
  previous_assignment_method text not null,
  previous_rule_id uuid references local_intel.research_source_classification_rules(id) on delete set null,
  previous_confidence numeric,
  previous_rationale text,
  previous_metadata jsonb not null default '{}'::jsonb,
  replacement_source_class_id uuid references local_intel.research_source_classes(id) on delete restrict,
  replacement_rule_id uuid references local_intel.research_source_classification_rules(id) on delete set null,
  supersession_reason text not null,
  classifier_version text not null,
  superseded_at timestamptz not null default now()
);

create or replace function local_intel.block_source_class_assignment_history_mutation_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','local_intel'
as $function$
begin
  raise exception 'source_class_assignment_history is append-only';
end;
$function$;

drop trigger if exists source_class_assignment_history_append_only_v1 on local_intel.source_class_assignment_history;
create trigger source_class_assignment_history_append_only_v1
before update or delete on local_intel.source_class_assignment_history
for each row execute function local_intel.block_source_class_assignment_history_mutation_v1();

update local_intel.research_source_classification_rules
set priority = 35,
    rationale = 'Institutional, association, program, or credential-backed directory. Official publisher status does not make the directory first-party for a listed member; treat member identity claims as authoritative third-party evidence.',
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'party_relative_semantics','authoritative_third_party_for_listed_subject',
      'classification_version','2.0'
    ),
    updated_at = now()
where stable_key='credentialed_directory';

update local_intel.research_source_classification_rules
set rationale = 'Generic organization-controlled official web property. Specific institutional directory and registry rules take precedence and must not inherit first-party status merely from an official_* source kind.',
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'party_relative_semantics','first_party_only_when_publisher_controls_subject_identity_surface',
      'classification_version','2.0'
    ),
    updated_at = now()
where stable_key='first_party_official_generic';

create or replace function local_intel.refresh_source_class_assignments_v2()
returns table(classified_count bigint, unresolved_count bigint, excluded_count bigint)
language plpgsql
set search_path to 'local_intel','public'
as $function$
begin
  with computed as (
    select s.id as source_id,
           r.source_class_id,
           case when r.id is null then 'unresolved' else 'classified' end as assignment_state,
           case when r.id is null then 'unresolved' else 'rule' end as assignment_method,
           r.id as rule_id,
           r.confidence,
           coalesce(r.rationale,'No active governed classification rule matched this source.') as rationale,
           jsonb_build_object('source_kind',s.source_kind,'publisher',s.publisher,'classifier_version','2.0') as metadata
    from local_intel.sources s
    left join lateral (
      select rr.*
      from local_intel.research_source_classification_rules rr
      where rr.status='active'
        and s.source_kind ~ rr.source_kind_regex
        and (rr.publisher_regex is null or coalesce(s.publisher,'') ~* rr.publisher_regex)
      order by rr.priority asc, rr.stable_key asc
      limit 1
    ) r on true
  ), changed as (
    select a.*, c.source_class_id as replacement_source_class_id, c.rule_id as replacement_rule_id
    from local_intel.source_class_assignments a
    join computed c on c.source_id=a.source_id
    where a.assignment_method <> 'manual'
      and (a.source_class_id is distinct from c.source_class_id
        or a.assignment_state is distinct from c.assignment_state
        or a.rule_id is distinct from c.rule_id
        or a.confidence is distinct from c.confidence
        or a.rationale is distinct from c.rationale)
  )
  insert into local_intel.source_class_assignment_history (
    source_id,previous_source_class_id,previous_assignment_state,previous_assignment_method,
    previous_rule_id,previous_confidence,previous_rationale,previous_metadata,
    replacement_source_class_id,replacement_rule_id,supersession_reason,classifier_version
  )
  select source_id,source_class_id,assignment_state,assignment_method,rule_id,confidence,rationale,coalesce(metadata,'{}'::jsonb),
         replacement_source_class_id,replacement_rule_id,'governed_source_classification_refresh','2.0'
  from changed;

  with computed as (
    select s.id as source_id,
           r.source_class_id,
           case when r.id is null then 'unresolved' else 'classified' end as assignment_state,
           case when r.id is null then 'unresolved' else 'rule' end as assignment_method,
           r.id as rule_id,
           r.confidence,
           coalesce(r.rationale,'No active governed classification rule matched this source.') as rationale,
           jsonb_build_object('source_kind',s.source_kind,'publisher',s.publisher,'classifier_version','2.0') as metadata
    from local_intel.sources s
    left join lateral (
      select rr.*
      from local_intel.research_source_classification_rules rr
      where rr.status='active'
        and s.source_kind ~ rr.source_kind_regex
        and (rr.publisher_regex is null or coalesce(s.publisher,'') ~* rr.publisher_regex)
      order by rr.priority asc, rr.stable_key asc
      limit 1
    ) r on true
  )
  insert into local_intel.source_class_assignments
    (source_id,source_class_id,assignment_state,assignment_method,rule_id,confidence,rationale,metadata,classified_at,updated_at)
  select source_id,source_class_id,assignment_state,assignment_method,rule_id,confidence,rationale,metadata,now(),now()
  from computed
  on conflict (source_id) do update set
    source_class_id=excluded.source_class_id,
    assignment_state=excluded.assignment_state,
    assignment_method=excluded.assignment_method,
    rule_id=excluded.rule_id,
    confidence=excluded.confidence,
    rationale=excluded.rationale,
    metadata=excluded.metadata,
    classified_at=excluded.classified_at,
    updated_at=excluded.updated_at
  where local_intel.source_class_assignments.assignment_method <> 'manual';

  return query
  select count(*) filter (where assignment_state='classified'),
         count(*) filter (where assignment_state='unresolved'),
         count(*) filter (where assignment_state='excluded')
  from local_intel.source_class_assignments;
end;
$function$;

create or replace function local_intel.refresh_source_class_assignments_v1()
returns table(classified_count bigint, unresolved_count bigint, excluded_count bigint)
language sql
set search_path to 'local_intel','public'
as $function$
  select * from local_intel.refresh_source_class_assignments_v2();
$function$;

create or replace view local_intel.v_research_source_inventory_governed_v2 as
select s.id as source_id,
       s.source_url,
       s.source_kind,
       s.publisher,
       s.title,
       s.source_date,
       s.retrieved_at,
       a.assignment_state,
       a.assignment_method,
       a.confidence as classification_confidence,
       c.stable_key as source_class_key,
       c.label as source_class_label,
       c.authority_tier,
       c.publisher_authority,
       c.default_subject_party_relationship,
       r.stable_key as classification_rule_key,
       a.rationale as classification_rationale
from local_intel.sources s
left join local_intel.source_class_assignments a on a.source_id=s.id
left join local_intel.research_source_classes c on c.id=a.source_class_id
left join local_intel.research_source_classification_rules r on r.id=a.rule_id;

select * from local_intel.refresh_source_class_assignments_v2();