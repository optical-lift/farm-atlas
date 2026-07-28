-- Owner-only Trail lineage review: explicit candidate queue, provenance decisions, and bounded audit read.

create or replace function atlas.owner_trail_lineage_audit_v1(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if not atlas.is_organization_owner(p_organization_id) then
    raise exception 'Owner Trail audit access is not active.' using errcode = '42501';
  end if;

  with evidence_rows as (
    select
      e.id,
      e.trail_binding_id,
      e.node_key,
      e.source_type,
      e.source_id,
      e.evidence_status,
      e.link_method,
      e.confidence,
      e.occurred_at,
      e.confirmed_at,
      e.metadata,
      b.subject_kind,
      b.subject_id,
      b.current_node_key,
      b.status as binding_status,
      tp.stable_key as profile_key,
      tp.label as profile_label,
      n.label as node_label,
      n.node_order,
      p.id as project_id,
      p.title as project_title,
      p.workstream,
      coalesce(
        t.title,
        nullif(e.metadata ->> 'source_title', ''),
        nullif(e.metadata ->> 'task_title', ''),
        initcap(replace(e.source_type, '_', ' '))
      ) as source_title,
      coalesce(
        t.status,
        nullif(e.metadata ->> 'source_status', ''),
        nullif(e.metadata ->> 'task_status', '')
      ) as source_status,
      coalesce(t.completed_at, e.occurred_at) as source_date
    from atlas.trail_evidence_links e
    join atlas.trail_bindings b on b.id = e.trail_binding_id
    join atlas.trail_profiles tp on tp.id = b.profile_id
    join atlas.trail_profile_nodes n
      on n.profile_id = b.profile_id
     and n.node_key = e.node_key
    left join atlas.projects p
      on b.subject_kind = 'project'
     and p.id = b.subject_id
    left join atlas.tasks t
      on e.source_type in ('task','project_task')
     and e.source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and t.id = e.source_id::uuid
    where b.organization_id = p_organization_id
      and b.status <> 'archived'
  ), unresolved_nodes as (
    select
      b.id as trail_binding_id,
      b.subject_kind,
      b.subject_id,
      b.current_node_key,
      tp.stable_key as profile_key,
      tp.label as profile_label,
      n.node_key,
      n.label as node_label,
      n.node_order,
      p.id as project_id,
      p.title as project_title,
      p.workstream
    from atlas.trail_bindings b
    join atlas.trail_profiles tp on tp.id = b.profile_id
    join atlas.trail_profile_nodes current_node
      on current_node.profile_id = b.profile_id
     and current_node.node_key = b.current_node_key
    join atlas.trail_profile_nodes n
      on n.profile_id = b.profile_id
     and n.node_order < current_node.node_order
    left join atlas.projects p
      on b.subject_kind = 'project'
     and p.id = b.subject_id
    where b.organization_id = p_organization_id
      and b.status <> 'archived'
      and not exists (
        select 1
        from atlas.trail_evidence_links accepted
        where accepted.trail_binding_id = b.id
          and accepted.node_key = n.node_key
          and accepted.evidence_status = 'accepted'
      )
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'pending', (select count(*) from evidence_rows where evidence_status = 'pending'),
      'accepted', (select count(*) from evidence_rows where evidence_status = 'accepted'),
      'rejected', (select count(*) from evidence_rows where evidence_status = 'rejected'),
      'unresolvedNodes', (select count(*) from unresolved_nodes)
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'evidenceId', r.id,
          'trailBindingId', r.trail_binding_id,
          'nodeKey', r.node_key,
          'nodeLabel', r.node_label,
          'nodeOrder', r.node_order,
          'sourceType', r.source_type,
          'sourceId', r.source_id,
          'sourceTitle', r.source_title,
          'sourceStatus', r.source_status,
          'sourceDate', r.source_date,
          'status', r.evidence_status,
          'linkMethod', r.link_method,
          'confidence', r.confidence,
          'occurredAt', r.occurred_at,
          'confirmedAt', r.confirmed_at,
          'subjectKind', r.subject_kind,
          'subjectId', r.subject_id,
          'currentNodeKey', r.current_node_key,
          'bindingStatus', r.binding_status,
          'profileKey', r.profile_key,
          'profileLabel', r.profile_label,
          'projectId', r.project_id,
          'projectTitle', r.project_title,
          'workstream', r.workstream,
          'matchReason', coalesce(
            nullif(r.metadata ->> 'match_reason', ''),
            nullif(r.metadata ->> 'candidate_reason', ''),
            nullif(r.metadata ->> 'completion_source', ''),
            r.link_method
          ),
          'reviewNote', nullif(r.metadata ->> 'review_note', '')
        )
        order by
          case r.evidence_status when 'pending' then 0 when 'accepted' then 1 when 'rejected' then 2 else 3 end,
          r.occurred_at desc,
          r.node_order
      )
      from evidence_rows r
    ), '[]'::jsonb),
    'unresolvedNodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'trailBindingId', u.trail_binding_id,
          'subjectKind', u.subject_kind,
          'subjectId', u.subject_id,
          'projectId', u.project_id,
          'projectTitle', u.project_title,
          'workstream', u.workstream,
          'profileKey', u.profile_key,
          'profileLabel', u.profile_label,
          'nodeKey', u.node_key,
          'nodeLabel', u.node_label,
          'nodeOrder', u.node_order,
          'currentNodeKey', u.current_node_key
        )
        order by u.project_title nulls last, u.node_order
      )
      from unresolved_nodes u
    ), '[]'::jsonb)
  ) into v_result;

  return coalesce(v_result, jsonb_build_object(
    'summary', jsonb_build_object('pending',0,'accepted',0,'rejected',0,'unresolvedNodes',0),
    'items', '[]'::jsonb,
    'unresolvedNodes', '[]'::jsonb
  ));
end;
$$;

create or replace function atlas.queue_trail_lineage_candidates_v1(
  p_organization_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_inserted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if not atlas.is_organization_owner(p_organization_id) then
    raise exception 'Owner Trail audit access is not active.' using errcode = '42501';
  end if;

  with candidates as (
    select
      b.id as trail_binding_id,
      n.node_key,
      t.id as task_id,
      p.id as project_id,
      p.title as project_title,
      ps.id as project_step_id,
      ps.title as project_step_title,
      t.title as task_title,
      t.status as task_status,
      ps.status as step_status,
      coalesce(t.completed_at, ps.completed_at, t.updated_at) as occurred_at,
      case
        when nullif(ps.metadata ->> 'trail_node_key', '') = n.node_key then 0.900::numeric
        else 0.750::numeric
      end as confidence,
      case
        when nullif(ps.metadata ->> 'trail_node_key', '') = n.node_key then 'explicit project-step Trail node'
        else 'legacy project-step order match'
      end as match_reason
    from atlas.trail_bindings b
    join atlas.projects p
      on b.subject_kind = 'project'
     and p.id = b.subject_id
    join atlas.project_steps ps
      on ps.project_id = p.id
     and ps.linked_task_id is not null
    join atlas.tasks t on t.id = ps.linked_task_id
    join atlas.trail_profile_nodes n
      on n.profile_id = b.profile_id
     and (
       n.node_key = nullif(ps.metadata ->> 'trail_node_key', '')
       or (
         nullif(ps.metadata ->> 'trail_node_key', '') is null
         and n.node_order = ps.step_order
       )
     )
    where b.organization_id = p_organization_id
      and b.status <> 'archived'
      and (t.completed_at is not null or ps.completed_at is not null)
      and not exists (
        select 1
        from atlas.trail_evidence_links existing
        where existing.trail_binding_id = b.id
          and existing.node_key = n.node_key
          and existing.source_type in ('task','project_task')
          and existing.source_id = t.id::text
      )
  )
  insert into atlas.trail_evidence_links (
    trail_binding_id,
    node_key,
    source_type,
    source_id,
    evidence_status,
    link_method,
    confidence,
    occurred_at,
    metadata
  )
  select
    c.trail_binding_id,
    c.node_key,
    'project_task',
    c.task_id::text,
    'pending',
    'strong',
    c.confidence,
    c.occurred_at,
    jsonb_build_object(
      'candidate_source', 'queue_trail_lineage_candidates_v1',
      'candidate_reason', c.match_reason,
      'match_reason', c.match_reason,
      'project_id', c.project_id,
      'project_title', c.project_title,
      'project_step_id', c.project_step_id,
      'project_step_title', c.project_step_title,
      'task_title', c.task_title,
      'task_status', c.task_status,
      'step_status', c.step_status
    )
  from candidates c
  on conflict (trail_binding_id, node_key, source_type, source_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function atlas.review_trail_evidence_v1(
  p_evidence_id uuid,
  p_decision text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_evidence atlas.trail_evidence_links%rowtype;
  v_binding atlas.trail_bindings%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_active_release_count integer := 0;
  v_next_node_key text;
  v_next_node_label text;
  v_project_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if v_decision not in ('accept','reject') then
    raise exception 'Trail evidence decision must be accept or reject.' using errcode = '22023';
  end if;

  select e.* into v_evidence
  from atlas.trail_evidence_links e
  where e.id = p_evidence_id
  for update;

  if v_evidence.id is null then
    raise exception 'Trail evidence candidate not found.' using errcode = 'P0002';
  end if;

  select b.* into v_binding
  from atlas.trail_bindings b
  where b.id = v_evidence.trail_binding_id;

  if v_binding.id is null or not atlas.is_organization_owner(v_binding.organization_id) then
    raise exception 'Owner Trail audit access is not active.' using errcode = '42501';
  end if;

  if v_evidence.evidence_status <> 'pending' then
    raise exception 'This Trail evidence candidate has already been reviewed.' using errcode = '22023';
  end if;

  update atlas.trail_evidence_links
  set evidence_status = case when v_decision = 'accept' then 'accepted' else 'rejected' end,
      link_method = case when v_decision = 'accept' then 'confirmed' else link_method end,
      confidence = case when v_decision = 'accept' then greatest(confidence, 0.950) else confidence end,
      confirmed_by_user_id = auth.uid(),
      confirmed_at = now(),
      metadata = metadata || jsonb_build_object(
        'review_decision', v_decision,
        'review_note', nullif(btrim(coalesce(p_note, '')), ''),
        'reviewed_at', now()
      ),
      updated_at = now()
  where id = v_evidence.id;

  if v_decision = 'accept'
     and v_binding.status = 'active'
     and v_binding.current_node_key = v_evidence.node_key then
    select count(*)::integer into v_active_release_count
    from atlas.trail_task_releases r
    where r.trail_binding_id = v_binding.id
      and r.node_key = v_evidence.node_key
      and r.release_status = 'active';

    if v_active_release_count = 0 then
      select n.node_key, n.label
      into v_next_node_key, v_next_node_label
      from atlas.trail_profile_nodes current_node
      join atlas.trail_profile_nodes n
        on n.profile_id = current_node.profile_id
       and n.node_order > current_node.node_order
      where current_node.profile_id = v_binding.profile_id
        and current_node.node_key = v_evidence.node_key
      order by n.node_order
      limit 1;

      update atlas.trail_bindings
      set current_node_key = v_next_node_key,
          status = case when v_next_node_key is null then 'complete' else 'active' end,
          metadata = metadata || jsonb_build_object(
            'last_completed_node_key', v_evidence.node_key,
            'last_advanced_at', now(),
            'last_advance_source_evidence_id', v_evidence.id,
            'last_advance_source', 'owner_lineage_review'
          ),
          updated_at = now()
      where id = v_binding.id
        and current_node_key = v_evidence.node_key;
    end if;
  end if;

  if v_binding.subject_kind = 'project' then
    v_project_id := v_binding.subject_id;

    update atlas.projects
    set last_movement_at = case when v_decision = 'accept' then now() else last_movement_at end,
        current_milestone = case
          when v_decision = 'accept' and v_next_node_key is not null then v_next_node_label
          else current_milestone
        end,
        health_status = case
          when v_decision = 'accept' and v_active_release_count = 0 and v_next_node_key is null
               and v_binding.current_node_key = v_evidence.node_key then 'complete'
          when v_decision = 'accept' then 'moving'
          else health_status
        end,
        updated_at = now()
    where id = v_project_id;
  end if;

  return v_evidence.id;
end;
$$;

grant execute on function atlas.owner_trail_lineage_audit_v1(uuid) to authenticated;
grant execute on function atlas.queue_trail_lineage_candidates_v1(uuid) to authenticated;
grant execute on function atlas.review_trail_evidence_v1(uuid, text, text) to authenticated;

revoke all on function atlas.owner_trail_lineage_audit_v1(uuid) from anon;
revoke all on function atlas.queue_trail_lineage_candidates_v1(uuid) from anon;
revoke all on function atlas.review_trail_evidence_v1(uuid, text, text) from anon;

comment on function atlas.owner_trail_lineage_audit_v1(uuid) is
  'Owner-only bounded Trail evidence audit with pending provenance reviews and unresolved earlier nodes.';
comment on function atlas.queue_trail_lineage_candidates_v1(uuid) is
  'Explicit owner-triggered scan that queues only deterministic completed project-step candidates; passive reads never write.';
comment on function atlas.review_trail_evidence_v1(uuid, text, text) is
  'Owner confirmation or rejection of one pending Trail evidence candidate with provenance and cautious current-node advancement.';
