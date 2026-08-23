create table if not exists local_intel.search_discovery_evidence (
  id uuid primary key default gen_random_uuid(),
  search_query_id uuid not null references local_intel.search_queries(id) on delete cascade,
  discovery_work_id uuid references local_intel.search_discovery_queue(id) on delete set null,
  source_id uuid not null references local_intel.sources(id),
  source_record_key text not null check (btrim(source_record_key) <> ''),
  subject_kind text not null check (btrim(subject_kind) <> ''),
  subject_key text,
  entity_id uuid references local_intel.entities(id),
  organization_entity_id uuid references local_intel.entities(id),
  organization_name text,
  observed_name text,
  role_title text,
  role_function text,
  email text,
  phone text,
  website_url text,
  evidence_payload jsonb not null default '{}'::jsonb,
  reconciliation_status text not null default 'pending' check (reconciliation_status in ('pending','candidate','applied','conflict','rejected')),
  ingestion_candidate_id uuid references local_intel.entity_ingestion_candidates(id) on delete set null,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(search_query_id, source_id, source_record_key)
);

create index if not exists search_discovery_evidence_query_status_idx
  on local_intel.search_discovery_evidence(search_query_id,reconciliation_status,created_at);
create index if not exists search_discovery_evidence_candidate_idx
  on local_intel.search_discovery_evidence(ingestion_candidate_id)
  where ingestion_candidate_id is not null;
create index if not exists search_discovery_evidence_entity_idx
  on local_intel.search_discovery_evidence(entity_id)
  where entity_id is not null;
create index if not exists search_discovery_evidence_source_idx
  on local_intel.search_discovery_evidence(source_id);

alter table local_intel.search_discovery_evidence enable row level security;
revoke all on local_intel.search_discovery_evidence from public, anon, authenticated, service_role;

create or replace function local_intel.sync_canonical_search_field_v1(
  p_entity_id uuid,
  p_field_name text,
  p_field_value jsonb,
  p_source_id uuid,
  p_evidence_note text default null,
  p_observed_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare
  v_count integer := 0;
  v_hold record;
begin
  if p_entity_id is null or p_source_id is null or p_field_value is null or p_field_value = 'null'::jsonb then
    return 0;
  end if;
  if nullif(btrim(p_field_name),'') is null then
    return 0;
  end if;
  if not exists (select 1 from local_intel.entities where id=p_entity_id) then
    return 0;
  end if;
  if not exists (select 1 from local_intel.sources where id=p_source_id) then
    return 0;
  end if;

  for v_hold in
    select h.search_query_id,h.subject_key
    from local_intel.search_field_holds h
    join local_intel.search_queries q on q.id=h.search_query_id
    where h.entity_id=p_entity_id
      and h.field_name=p_field_name
      and h.status='holding'
      and q.status='in_process'
  loop
    if not exists (
      select 1 from local_intel.search_findings f
      where f.search_query_id=v_hold.search_query_id
        and f.subject_key=v_hold.subject_key
        and f.entity_id=p_entity_id
        and f.field_name=p_field_name
        and f.field_value=p_field_value
        and f.source_id=p_source_id
    ) then
      insert into local_intel.search_findings(
        search_query_id,subject_key,entity_id,field_name,field_value,
        source_id,evidence_note,observed_at,reconciliation_status,metadata
      ) values (
        v_hold.search_query_id,v_hold.subject_key,p_entity_id,p_field_name,p_field_value,
        p_source_id,p_evidence_note,coalesce(p_observed_at,now()),'pending',coalesce(p_metadata,'{}'::jsonb)
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function local_intel.sync_canonical_search_field_v1(uuid,text,jsonb,uuid,text,timestamptz,jsonb) from public, anon, authenticated, service_role;

create or replace function local_intel.search_contact_point_sync_v1()
returns trigger
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
begin
  if new.source_id is not null and nullif(btrim(new.contact_value),'') is not null then
    perform local_intel.sync_canonical_search_field_v1(
      new.entity_id,
      new.contact_type,
      to_jsonb(new.contact_value),
      new.source_id,
      'Canonical contact evidence became available during an active search.',
      coalesce(new.verified_at,new.last_checked_at,new.updated_at,new.created_at,now()),
      jsonb_build_object('contact_point_id',new.id,'sync_origin','contact_points')
    );
  end if;
  return new;
end;
$$;
revoke all on function local_intel.search_contact_point_sync_v1() from public, anon, authenticated, service_role;

drop trigger if exists contact_points_search_hold_sync_v1 on local_intel.contact_points;
create trigger contact_points_search_hold_sync_v1
after insert or update of contact_value,source_id,verification_state on local_intel.contact_points
for each row execute function local_intel.search_contact_point_sync_v1();

create or replace function local_intel.search_relationship_sync_v1()
returns trigger
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
begin
  if new.source_id is not null and new.is_current then
    if nullif(btrim(new.role_title),'') is not null then
      perform local_intel.sync_canonical_search_field_v1(
        new.subject_entity_id,'title',to_jsonb(new.role_title),new.source_id,
        'Canonical current role title became available during an active search.',
        coalesce(new.last_verified_at,new.last_seen_current_at,new.updated_at,new.created_at,now()),
        jsonb_build_object('relationship_id',new.id,'sync_origin','entity_relationships')
      );
    end if;
    if nullif(btrim(new.role_function),'') is not null then
      perform local_intel.sync_canonical_search_field_v1(
        new.subject_entity_id,'role_function',to_jsonb(new.role_function),new.source_id,
        'Canonical current role function became available during an active search.',
        coalesce(new.last_verified_at,new.last_seen_current_at,new.updated_at,new.created_at,now()),
        jsonb_build_object('relationship_id',new.id,'sync_origin','entity_relationships')
      );
    end if;
  end if;
  return new;
end;
$$;
revoke all on function local_intel.search_relationship_sync_v1() from public, anon, authenticated, service_role;

drop trigger if exists entity_relationships_search_hold_sync_v1 on local_intel.entity_relationships;
create trigger entity_relationships_search_hold_sync_v1
after insert or update of role_title,role_function,source_id,is_current on local_intel.entity_relationships
for each row execute function local_intel.search_relationship_sync_v1();

create or replace function local_intel.apply_search_discovery_evidence_v1(
  p_evidence_id uuid,
  p_entity_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare
  v_e local_intel.search_discovery_evidence%rowtype;
  v_entity_id uuid;
  v_subject_key text;
  v_entity_type text;
  v_query_status text;
  v_findings integer := 0;
  v_contacts integer := 0;
  v_roles integer := 0;
  v_field record;
  v_contact_scope text;
  v_contact_context text;
begin
  select * into v_e from local_intel.search_discovery_evidence where id=p_evidence_id for update;
  if v_e.id is null then raise exception 'unknown discovery evidence %',p_evidence_id; end if;

  v_entity_id := coalesce(p_entity_id,v_e.entity_id);
  if v_entity_id is null then raise exception 'canonical entity_id is required to apply discovery evidence'; end if;

  select stable_key,entity_type into v_subject_key,v_entity_type
  from local_intel.entities where id=v_entity_id;
  if v_subject_key is null then raise exception 'unknown canonical entity %',v_entity_id; end if;

  select status into v_query_status from local_intel.search_queries where id=v_e.search_query_id;

  v_contact_scope := nullif(btrim(v_e.evidence_payload->>'contact_scope'),'');
  v_contact_context := coalesce(nullif(btrim(v_e.evidence_payload->>'contact_context'),''),'source_observed');

  if nullif(btrim(v_e.email),'') is not null then
    insert into local_intel.contact_points(
      entity_id,contact_type,contact_value,context,contact_scope,is_primary,visibility,
      verification_state,deliverability_state,marketing_status,source_id,metadata,normalized_value,last_checked_at
    ) values (
      v_entity_id,'email',btrim(v_e.email),v_contact_context,coalesce(v_contact_scope,'source_associated'),false,
      coalesce(nullif(v_e.evidence_payload->>'visibility',''),'source_observed'),
      'source_verified','unknown','unassessed',v_e.source_id,
      jsonb_build_object('search_discovery_evidence_id',v_e.id)||v_e.evidence_payload,
      lower(btrim(v_e.email)),now()
    )
    on conflict (entity_id,contact_type,normalized_value)
    do update set
      source_id=coalesce(local_intel.contact_points.source_id,excluded.source_id),
      metadata=local_intel.contact_points.metadata||excluded.metadata,
      last_checked_at=now(),updated_at=now();
    v_contacts := v_contacts + 1;
  end if;

  if nullif(btrim(v_e.phone),'') is not null then
    insert into local_intel.contact_points(
      entity_id,contact_type,contact_value,context,contact_scope,is_primary,visibility,
      verification_state,deliverability_state,marketing_status,source_id,metadata,normalized_value,last_checked_at
    ) values (
      v_entity_id,'phone',btrim(v_e.phone),v_contact_context,coalesce(v_contact_scope,'source_associated'),false,
      coalesce(nullif(v_e.evidence_payload->>'visibility',''),'source_observed'),
      'source_verified','unknown','unassessed',v_e.source_id,
      jsonb_build_object('search_discovery_evidence_id',v_e.id)||v_e.evidence_payload,
      regexp_replace(btrim(v_e.phone),'[^0-9+]','','g'),now()
    )
    on conflict (entity_id,contact_type,normalized_value)
    do update set
      source_id=coalesce(local_intel.contact_points.source_id,excluded.source_id),
      metadata=local_intel.contact_points.metadata||excluded.metadata,
      last_checked_at=now(),updated_at=now();
    v_contacts := v_contacts + 1;
  end if;

  if v_e.organization_entity_id is not null and nullif(btrim(v_e.role_title),'') is not null then
    if not exists (select 1 from local_intel.entities where id=v_e.organization_entity_id) then
      raise exception 'unknown organization_entity_id %',v_e.organization_entity_id;
    end if;
    insert into local_intel.entity_relationships(
      subject_entity_id,relationship_kind,object_entity_id,role_title,is_current,
      verification_state,last_verified_at,source_id,metadata,role_function,truth_state,
      last_seen_current_at,conflict_state
    ) values (
      v_entity_id,'holds_role_at',v_e.organization_entity_id,btrim(v_e.role_title),true,
      'source_verified',now(),v_e.source_id,
      jsonb_build_object('search_discovery_evidence_id',v_e.id)||v_e.evidence_payload,
      nullif(btrim(v_e.role_function),''),'observed',now(),'none'
    )
    on conflict (subject_entity_id,relationship_kind,object_entity_id,(coalesce(role_title,''))) where is_current
    do update set
      role_function=coalesce(local_intel.entity_relationships.role_function,excluded.role_function),
      metadata=local_intel.entity_relationships.metadata||excluded.metadata,
      last_seen_current_at=greatest(coalesce(local_intel.entity_relationships.last_seen_current_at,'epoch'::timestamptz),excluded.last_seen_current_at),
      updated_at=now();
    v_roles := v_roles + 1;
  end if;

  if v_query_status='in_process' then
    for v_field in
      select * from (values
        ('name'::text, case when nullif(btrim(v_e.observed_name),'') is null then null else to_jsonb(btrim(v_e.observed_name)) end),
        ('email'::text, case when nullif(btrim(v_e.email),'') is null then null else to_jsonb(btrim(v_e.email)) end),
        ('title'::text, case when nullif(btrim(v_e.role_title),'') is null then null else to_jsonb(btrim(v_e.role_title)) end),
        ('role_function'::text, case when nullif(btrim(v_e.role_function),'') is null then null else to_jsonb(btrim(v_e.role_function)) end),
        ('phone'::text, case when nullif(btrim(v_e.phone),'') is null then null else to_jsonb(btrim(v_e.phone)) end),
        ('website'::text, case when nullif(btrim(v_e.website_url),'') is null then null else to_jsonb(btrim(v_e.website_url)) end)
      ) as x(field_name,field_value)
      where field_value is not null
    loop
      if not exists (
        select 1 from local_intel.search_findings f
        where f.search_query_id=v_e.search_query_id
          and f.subject_key=v_subject_key
          and f.entity_id=v_entity_id
          and f.field_name=v_field.field_name
          and f.field_value=v_field.field_value
          and f.source_id=v_e.source_id
      ) then
        insert into local_intel.search_findings(
          search_query_id,subject_key,entity_id,field_name,field_value,source_id,evidence_note,observed_at,reconciliation_status,metadata
        ) values (
          v_e.search_query_id,v_subject_key,v_entity_id,v_field.field_name,v_field.field_value,v_e.source_id,
          'Explicit field gathered by search discovery intake.',now(),'pending',
          jsonb_build_object('search_discovery_evidence_id',v_e.id)||v_e.evidence_payload
        );
        v_findings := v_findings + 1;
      end if;
    end loop;
  end if;

  update local_intel.search_discovery_evidence
     set entity_id=v_entity_id,subject_key=v_subject_key,reconciliation_status='applied',reconciled_at=now(),updated_at=now()
   where id=v_e.id;

  return jsonb_build_object('evidence_id',v_e.id,'entity_id',v_entity_id,'subject_key',v_subject_key,
    'findings_added',v_findings,'contacts_applied',v_contacts,'roles_applied',v_roles,'status','applied');
end;
$$;
revoke all on function local_intel.apply_search_discovery_evidence_v1(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function local_intel.ingest_search_discovery_evidence_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare
  v_query_id uuid := nullif(p_payload->>'search_query_id','')::uuid;
  v_work_id uuid := nullif(p_payload->>'discovery_work_id','')::uuid;
  v_source_id uuid := nullif(p_payload->>'source_id','')::uuid;
  v_entity_id uuid := nullif(p_payload->>'entity_id','')::uuid;
  v_org_id uuid := nullif(p_payload->>'organization_entity_id','')::uuid;
  v_subject_kind text := btrim(coalesce(p_payload->>'subject_kind',''));
  v_source_record_key text := btrim(coalesce(p_payload->>'source_record_key',''));
  v_evidence_id uuid;
  v_ingestion_source_id uuid;
  v_candidate_id uuid;
  v_source_role text;
  v_apply jsonb;
begin
  if v_query_id is null or not exists (select 1 from local_intel.search_queries where id=v_query_id and status='in_process') then
    raise exception 'active search_query_id is required';
  end if;
  if v_source_id is null or not exists (select 1 from local_intel.sources where id=v_source_id) then
    raise exception 'existing source_id is required';
  end if;
  if v_subject_kind='' then raise exception 'subject_kind is required'; end if;
  if v_source_record_key='' then raise exception 'source_record_key is required'; end if;
  if nullif(btrim(coalesce(p_payload->>'observed_name','')),'') is null
     and nullif(btrim(coalesce(p_payload->>'email','')),'') is null
     and nullif(btrim(coalesce(p_payload->>'role_title','')),'') is null
     and nullif(btrim(coalesce(p_payload->>'phone','')),'') is null
     and nullif(btrim(coalesce(p_payload->>'website_url','')),'') is null then
    raise exception 'at least one explicit observed field is required';
  end if;

  if v_work_id is null then
    select id into v_work_id from local_intel.search_discovery_queue
    where search_query_id=v_query_id and status='in_process'
    order by claimed_at desc nulls last,created_at desc limit 1;
  end if;

  insert into local_intel.search_discovery_evidence(
    search_query_id,discovery_work_id,source_id,source_record_key,subject_kind,subject_key,entity_id,
    organization_entity_id,organization_name,observed_name,role_title,role_function,email,phone,website_url,evidence_payload
  ) values (
    v_query_id,v_work_id,v_source_id,v_source_record_key,v_subject_kind,nullif(btrim(p_payload->>'subject_key'),''),v_entity_id,
    v_org_id,nullif(btrim(p_payload->>'organization_name'),''),nullif(btrim(p_payload->>'observed_name'),''),
    nullif(btrim(p_payload->>'role_title'),''),nullif(btrim(p_payload->>'role_function'),''),
    nullif(btrim(p_payload->>'email'),''),nullif(btrim(p_payload->>'phone'),''),nullif(btrim(p_payload->>'website_url'),''),
    coalesce(p_payload->'metadata','{}'::jsonb)
  )
  on conflict (search_query_id,source_id,source_record_key)
  do update set
    discovery_work_id=coalesce(excluded.discovery_work_id,local_intel.search_discovery_evidence.discovery_work_id),
    subject_key=coalesce(excluded.subject_key,local_intel.search_discovery_evidence.subject_key),
    entity_id=coalesce(excluded.entity_id,local_intel.search_discovery_evidence.entity_id),
    organization_entity_id=coalesce(excluded.organization_entity_id,local_intel.search_discovery_evidence.organization_entity_id),
    organization_name=coalesce(excluded.organization_name,local_intel.search_discovery_evidence.organization_name),
    observed_name=coalesce(excluded.observed_name,local_intel.search_discovery_evidence.observed_name),
    role_title=coalesce(excluded.role_title,local_intel.search_discovery_evidence.role_title),
    role_function=coalesce(excluded.role_function,local_intel.search_discovery_evidence.role_function),
    email=coalesce(excluded.email,local_intel.search_discovery_evidence.email),
    phone=coalesce(excluded.phone,local_intel.search_discovery_evidence.phone),
    website_url=coalesce(excluded.website_url,local_intel.search_discovery_evidence.website_url),
    evidence_payload=local_intel.search_discovery_evidence.evidence_payload||excluded.evidence_payload,
    updated_at=now()
  returning id,entity_id into v_evidence_id,v_entity_id;

  if v_entity_id is not null then
    v_apply := local_intel.apply_search_discovery_evidence_v1(v_evidence_id,v_entity_id);
    return v_apply;
  end if;

  v_source_role := case when v_subject_kind='person' then 'person_directory'
                        when v_subject_kind in ('business','organization','nonprofit') then 'organization_directory'
                        else 'other' end;

  select id into v_ingestion_source_id from local_intel.ingestion_sources
   where source_id=v_source_id and source_role=v_source_role;
  if v_ingestion_source_id is null then
    insert into local_intel.ingestion_sources(source_id,source_role,status,ingestion_priority,metadata)
    values(v_source_id,v_source_role,'active',50,jsonb_build_object('origin','search_discovery','search_query_id',v_query_id))
    on conflict (source_id,source_role) do update set updated_at=now()
    returning id into v_ingestion_source_id;
  end if;

  insert into local_intel.entity_ingestion_candidates(
    ingestion_source_id,source_record_key,proposed_entity_type,proposed_name,website_url,phone,email,
    proposed_relationship_target_name,proposed_role_title,confidence,review_state,metadata
  ) values (
    v_ingestion_source_id,v_source_record_key,v_subject_kind,
    coalesce(nullif(btrim(p_payload->>'observed_name'),''),v_source_record_key),
    nullif(btrim(p_payload->>'website_url'),''),nullif(btrim(p_payload->>'phone'),''),nullif(btrim(p_payload->>'email'),''),
    nullif(btrim(p_payload->>'organization_name'),''),nullif(btrim(p_payload->>'role_title'),''),
    1.0,'pending',
    jsonb_build_object('origin','search_discovery','search_query_id',v_query_id,'search_discovery_evidence_id',v_evidence_id,
      'confidence_kind','explicit_extraction_not_identity_match')||coalesce(p_payload->'metadata','{}'::jsonb)
  )
  on conflict (ingestion_source_id,source_record_key)
  do update set
    proposed_name=excluded.proposed_name,
    website_url=coalesce(excluded.website_url,local_intel.entity_ingestion_candidates.website_url),
    phone=coalesce(excluded.phone,local_intel.entity_ingestion_candidates.phone),
    email=coalesce(excluded.email,local_intel.entity_ingestion_candidates.email),
    proposed_relationship_target_name=coalesce(excluded.proposed_relationship_target_name,local_intel.entity_ingestion_candidates.proposed_relationship_target_name),
    proposed_role_title=coalesce(excluded.proposed_role_title,local_intel.entity_ingestion_candidates.proposed_role_title),
    metadata=local_intel.entity_ingestion_candidates.metadata||excluded.metadata,
    updated_at=now()
  returning id into v_candidate_id;

  update local_intel.search_discovery_evidence
     set ingestion_candidate_id=v_candidate_id,reconciliation_status='candidate',updated_at=now()
   where id=v_evidence_id;

  return jsonb_build_object('evidence_id',v_evidence_id,'ingestion_candidate_id',v_candidate_id,'status','candidate');
end;
$$;
revoke all on function local_intel.ingest_search_discovery_evidence_v1(jsonb) from public, anon, authenticated;
grant execute on function local_intel.ingest_search_discovery_evidence_v1(jsonb) to service_role;

create or replace function local_intel.search_discovery_candidate_apply_v1()
returns trigger
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare v_id uuid;
begin
  if new.matched_entity_id is not null
     and new.review_state in ('matched_existing','promoted')
     and (old.matched_entity_id is distinct from new.matched_entity_id or old.review_state is distinct from new.review_state) then
    for v_id in
      select id from local_intel.search_discovery_evidence
      where ingestion_candidate_id=new.id and reconciliation_status in ('candidate','pending')
    loop
      perform local_intel.apply_search_discovery_evidence_v1(v_id,new.matched_entity_id);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function local_intel.search_discovery_candidate_apply_v1() from public, anon, authenticated, service_role;

drop trigger if exists entity_ingestion_search_discovery_apply_v1 on local_intel.entity_ingestion_candidates;
create trigger entity_ingestion_search_discovery_apply_v1
after update of review_state,matched_entity_id on local_intel.entity_ingestion_candidates
for each row execute function local_intel.search_discovery_candidate_apply_v1();

create or replace function local_intel.get_search_discovery_loop_state_v1(p_search_query_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = local_intel, pg_catalog
as $$
with q as (
  select id,status,metadata from local_intel.search_queries where id=p_search_query_id
), c as (
  select count(distinct entity_id)::integer as complete_people
  from local_intel.get_search_complete_return_v1(p_search_query_id)
  where entity_id is not null
), h as (
  select count(*) filter (where status='holding')::integer as holds,
         count(*) filter (where status='resolved')::integer as resolved_holds
  from local_intel.search_field_holds where search_query_id=p_search_query_id
), e as (
  select count(*)::integer as evidence_rows,
         count(*) filter (where reconciliation_status='candidate')::integer as candidate_rows,
         count(*) filter (where reconciliation_status='applied')::integer as applied_rows
  from local_intel.search_discovery_evidence where search_query_id=p_search_query_id
), d as (
  select status as discovery_status,metadata as discovery_metadata
  from local_intel.search_discovery_queue where search_query_id=p_search_query_id
  order by created_at desc limit 1
)
select jsonb_build_object(
  'search_query_id',q.id,'query_status',q.status,'goal_count',coalesce((q.metadata->>'goal_count')::integer,0),
  'complete_people',coalesce(c.complete_people,0),'holds',coalesce(h.holds,0),'resolved_holds',coalesce(h.resolved_holds,0),
  'evidence_rows',coalesce(e.evidence_rows,0),'candidate_rows',coalesce(e.candidate_rows,0),'applied_rows',coalesce(e.applied_rows,0),
  'discovery_status',d.discovery_status,'discovery_metadata',coalesce(d.discovery_metadata,'{}'::jsonb)
)
from q cross join c cross join h cross join e left join d on true;
$$;
revoke all on function local_intel.get_search_discovery_loop_state_v1(uuid) from public, anon, authenticated;
grant execute on function local_intel.get_search_discovery_loop_state_v1(uuid) to service_role;

create or replace function local_intel.claim_search_discovery_batch_v1(p_search_query_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare
  v_goal integer;
  v_complete integer;
  v_row local_intel.search_discovery_queue%rowtype;
begin
  select coalesce((metadata->>'goal_count')::integer,0) into v_goal
  from local_intel.search_queries where id=p_search_query_id and status='in_process' for update;
  if not found then return null; end if;

  select count(distinct entity_id)::integer into v_complete
  from local_intel.get_search_complete_return_v1(p_search_query_id) where entity_id is not null;

  if v_goal>0 and v_complete>=v_goal then
    update local_intel.search_discovery_queue set status='complete',completed_at=now(),updated_at=now()
    where search_query_id=p_search_query_id and status<>'complete';
    update local_intel.search_queries set status='complete',completed_at=coalesce(completed_at,now()),updated_at=now()
    where id=p_search_query_id and status='in_process';
    return jsonb_build_object('status','complete','complete_people',v_complete,'goal_count',v_goal);
  end if;

  with picked as (
    select id from local_intel.search_discovery_queue
    where search_query_id=p_search_query_id and status='queued'
    order by created_at,id for update skip locked limit 1
  )
  update local_intel.search_discovery_queue q
     set status='in_process',claimed_at=now(),updated_at=now()
    from picked p where q.id=p.id returning q.* into v_row;

  if v_row.id is null then return null; end if;
  return to_jsonb(v_row)||jsonb_build_object('complete_people',v_complete,'goal_count',v_goal);
end;
$$;
revoke all on function local_intel.claim_search_discovery_batch_v1(uuid) from public, anon, authenticated;
grant execute on function local_intel.claim_search_discovery_batch_v1(uuid) to service_role;

create or replace function local_intel.finish_search_discovery_batch_v1(
  p_search_query_id uuid,
  p_batch_stats jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = local_intel, pg_catalog
as $$
declare
  v_goal integer;
  v_complete integer;
  v_batches integer;
  v_done boolean;
  v_state jsonb;
begin
  select coalesce((metadata->>'goal_count')::integer,0) into v_goal
  from local_intel.search_queries where id=p_search_query_id for update;
  if not found then raise exception 'unknown search query %',p_search_query_id; end if;

  select count(distinct entity_id)::integer into v_complete
  from local_intel.get_search_complete_return_v1(p_search_query_id) where entity_id is not null;
  v_done := v_goal>0 and v_complete>=v_goal;

  select coalesce((metadata->>'completed_batches')::integer,0)+1 into v_batches
  from local_intel.search_discovery_queue where search_query_id=p_search_query_id
  order by created_at desc limit 1;

  update local_intel.search_discovery_queue
     set status=case when v_done then 'complete' else 'queued' end,
         claimed_at=case when v_done then claimed_at else null end,
         completed_at=now(),
         metadata=metadata||jsonb_build_object(
           'completed_batches',coalesce(v_batches,1),
           'last_batch_completed_at',now(),
           'last_batch_stats',coalesce(p_batch_stats,'{}'::jsonb),
           'next_batch_number',coalesce(v_batches,1)+1
         ),
         updated_at=now()
   where search_query_id=p_search_query_id;

  if v_done then
    update local_intel.search_queries set status='complete',completed_at=coalesce(completed_at,now()),updated_at=now()
    where id=p_search_query_id and status='in_process';
  end if;

  v_state := local_intel.get_search_discovery_loop_state_v1(p_search_query_id);
  return v_state||jsonb_build_object('goal_reached',v_done);
end;
$$;
revoke all on function local_intel.finish_search_discovery_batch_v1(uuid,jsonb) from public, anon, authenticated;
grant execute on function local_intel.finish_search_discovery_batch_v1(uuid,jsonb) to service_role;

comment on table local_intel.search_discovery_evidence is 'Raw source-backed evidence gathered during query-driven discovery. Collection is preserved independently from downstream use decisions.';
comment on function local_intel.ingest_search_discovery_evidence_v1(jsonb) is 'Atomic discovery intake: preserve evidence, apply to an already-canonical subject, or route unresolved identity through the existing ingestion/resolver membrane.';
comment on function local_intel.finish_search_discovery_batch_v1(uuid,jsonb) is 'Queue-drain loop boundary: close a mixed discovery batch, measure the requested complete return, and queue the next batch unless the query goal is satisfied.';