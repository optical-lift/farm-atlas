alter table local_intel.search_discovery_evidence
  add column if not exists fields jsonb not null default '{}'::jsonb;

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
  v_fields jsonb;
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

  v_fields := coalesce(v_e.fields,'{}'::jsonb)
    || case when nullif(btrim(v_e.observed_name),'') is null then '{}'::jsonb else jsonb_build_object('name',v_e.observed_name) end
    || case when nullif(btrim(v_e.email),'') is null then '{}'::jsonb else jsonb_build_object('email',v_e.email) end
    || case when nullif(btrim(v_e.role_title),'') is null then '{}'::jsonb else jsonb_build_object('title',v_e.role_title) end
    || case when nullif(btrim(v_e.role_function),'') is null then '{}'::jsonb else jsonb_build_object('role_function',v_e.role_function) end
    || case when nullif(btrim(v_e.phone),'') is null then '{}'::jsonb else jsonb_build_object('phone',v_e.phone) end
    || case when nullif(btrim(v_e.website_url),'') is null then '{}'::jsonb else jsonb_build_object('website',v_e.website_url) end;

  if v_query_status='in_process' then
    for v_field in
      select key as field_name,value as field_value
      from jsonb_each(v_fields)
      where value is not null and value <> 'null'::jsonb
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
  v_fields jsonb := case when jsonb_typeof(p_payload->'fields')='object' then p_payload->'fields' else '{}'::jsonb end;
  v_evidence_id uuid;
  v_ingestion_source_id uuid;
  v_candidate_id uuid;
  v_source_role text;
  v_apply jsonb;
  v_name text;
  v_email text;
  v_title text;
  v_role_function text;
  v_phone text;
  v_website text;
begin
  if v_query_id is null or not exists (select 1 from local_intel.search_queries where id=v_query_id and status='in_process') then
    raise exception 'active search_query_id is required';
  end if;
  if v_source_id is null or not exists (select 1 from local_intel.sources where id=v_source_id) then
    raise exception 'existing source_id is required';
  end if;
  if v_subject_kind='' then raise exception 'subject_kind is required'; end if;
  if v_source_record_key='' then raise exception 'source_record_key is required'; end if;

  v_name := coalesce(nullif(btrim(p_payload->>'observed_name'),''),nullif(btrim(v_fields->>'name'),''));
  v_email := coalesce(nullif(btrim(p_payload->>'email'),''),nullif(btrim(v_fields->>'email'),''));
  v_title := coalesce(nullif(btrim(p_payload->>'role_title'),''),nullif(btrim(v_fields->>'title'),''));
  v_role_function := coalesce(nullif(btrim(p_payload->>'role_function'),''),nullif(btrim(v_fields->>'role_function'),''));
  v_phone := coalesce(nullif(btrim(p_payload->>'phone'),''),nullif(btrim(v_fields->>'phone'),''));
  v_website := coalesce(nullif(btrim(p_payload->>'website_url'),''),nullif(btrim(v_fields->>'website'),''));

  if v_fields='{}'::jsonb and v_name is null and v_email is null and v_title is null and v_phone is null and v_website is null then
    raise exception 'at least one explicit observed field is required';
  end if;

  if v_work_id is null then
    select id into v_work_id from local_intel.search_discovery_queue
    where search_query_id=v_query_id and status='in_process'
    order by claimed_at desc nulls last,created_at desc limit 1;
  end if;

  insert into local_intel.search_discovery_evidence(
    search_query_id,discovery_work_id,source_id,source_record_key,subject_kind,subject_key,entity_id,
    organization_entity_id,organization_name,observed_name,role_title,role_function,email,phone,website_url,fields,evidence_payload
  ) values (
    v_query_id,v_work_id,v_source_id,v_source_record_key,v_subject_kind,nullif(btrim(p_payload->>'subject_key'),''),v_entity_id,
    v_org_id,nullif(btrim(p_payload->>'organization_name'),''),v_name,v_title,v_role_function,v_email,v_phone,v_website,v_fields,
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
    fields=local_intel.search_discovery_evidence.fields||excluded.fields,
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
    coalesce(v_name,v_source_record_key),v_website,v_phone,v_email,
    nullif(btrim(p_payload->>'organization_name'),''),v_title,
    1.0,'pending',
    jsonb_build_object('origin','search_discovery','search_query_id',v_query_id,'search_discovery_evidence_id',v_evidence_id,
      'confidence_kind','explicit_extraction_not_identity_match','fields',v_fields)||coalesce(p_payload->'metadata','{}'::jsonb)
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

comment on column local_intel.search_discovery_evidence.fields is 'Generic explicit field/value evidence gathered for the active query. Unsupported or missing fields are omitted rather than filled.';