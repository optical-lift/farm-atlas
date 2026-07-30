create table if not exists atlas.task_problem_handoffs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  opened_by_user_id uuid references auth.users(id) on delete set null,
  opened_by_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  owner_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  original_assigned_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  original_visibility_scope text,
  original_assignee_key text,
  issue_text text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  opened_at timestamptz not null default now(),
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  resolved_by_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  resolved_at timestamptz,
  owner_response text,
  open_idempotency_key text not null,
  resolution_idempotency_key text,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists task_problem_handoffs_one_open_per_task
  on atlas.task_problem_handoffs(task_id)
  where status = 'open';

create unique index if not exists task_problem_handoffs_open_key
  on atlas.task_problem_handoffs(farm_id, open_idempotency_key);

create unique index if not exists task_problem_handoffs_resolution_key
  on atlas.task_problem_handoffs(farm_id, resolution_idempotency_key)
  where resolution_idempotency_key is not null;

create index if not exists task_problem_handoffs_owner_queue
  on atlas.task_problem_handoffs(farm_id, status, opened_at desc);

alter table atlas.task_problem_handoffs enable row level security;

create policy task_problem_handoffs_owner_read
  on atlas.task_problem_handoffs
  for select
  to authenticated
  using (atlas.is_farm_owner(farm_id));

create or replace function atlas.worker_open_task_problem_handoff_v1(
  p_task_id uuid,
  p_issue_text text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_existing atlas.task_problem_handoffs%rowtype;
  v_handoff atlas.task_problem_handoffs%rowtype;
  v_issue text := nullif(btrim(coalesce(p_issue_text,'')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')), '');
  v_role text;
  v_worker_membership_id uuid;
  v_owner_membership_id uuid;
  v_worker_key text;
  v_original_assignee_key text;
  v_transition jsonb;
begin
  if p_task_id is null or v_key is null then
    raise exception 'Task and idempotency key are required.' using errcode = '22023';
  end if;
  if v_issue is null then
    raise exception 'Describe the problem before sending it to the Owner.' using errcode = '22023';
  end if;
  if length(v_issue) > 2000 then
    raise exception 'Problem description must be 2000 characters or fewer.' using errcode = '22023';
  end if;

  select * into v_task
  from atlas.tasks
  where id = p_task_id
  for update;

  if v_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_worker_membership_id := atlas.current_membership_id(v_task.farm_id);

  select * into v_existing
  from atlas.task_problem_handoffs
  where task_id = v_task.id
    and status = 'open'
    and opened_by_membership_id = v_worker_membership_id
  order by opened_at desc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'handoffId',v_existing.id,
      'taskId',v_existing.task_id,
      'status',v_existing.status,
      'message','Problem already sent to the Owner.',
      'deduplicated',true
    );
  end if;

  if v_role not in ('farm_hand','manager')
    or v_worker_membership_id is null
    or v_task.visibility_scope <> 'assigned_worker'
    or v_task.assigned_membership_id <> v_worker_membership_id
  then
    raise exception 'This task is not assigned to the signed-in farm member.' using errcode = '42501';
  end if;

  select fm.id into v_owner_membership_id
  from atlas.farm_memberships fm
  where fm.farm_id = v_task.farm_id
    and fm.role = 'owner'
    and fm.active
  order by fm.created_at
  limit 1;

  if v_owner_membership_id is null then
    raise exception 'No active Owner account is available for this farm.' using errcode = 'P0003';
  end if;

  select fm.worker_key into v_worker_key
  from atlas.farm_memberships fm
  where fm.id = v_worker_membership_id;

  v_original_assignee_key := coalesce(
    nullif(v_task.metadata ->> 'assignee_key',''),
    nullif(v_task.metadata ->> 'assigned_to',''),
    nullif(v_worker_key,''),
    'anna'
  );

  perform pg_advisory_xact_lock(hashtextextended(v_task.farm_id::text || ':problem-handoff:' || v_task.id::text,0));

  v_transition := atlas.record_task_transition_v1(
    v_task.id,
    'blocked',
    'problem-handoff-open:' || v_key,
    null,
    null,
    v_issue,
    coalesce(v_task.action_key,'problem'),
    'owner_handoff',
    jsonb_build_object(
      'source','worker_problem_handoff',
      'issue_text',v_issue,
      'opened_by_membership_id',v_worker_membership_id
    ),
    null
  );

  insert into atlas.task_problem_handoffs (
    farm_id,task_id,opened_by_user_id,opened_by_membership_id,
    owner_membership_id,original_assigned_membership_id,
    original_visibility_scope,original_assignee_key,issue_text,
    open_idempotency_key,metadata
  ) values (
    v_task.farm_id,v_task.id,auth.uid(),v_worker_membership_id,
    v_owner_membership_id,v_task.assigned_membership_id,
    v_task.visibility_scope,v_original_assignee_key,v_issue,
    v_key,jsonb_build_object('transition_id',v_transition ->> 'transitionId')
  ) returning * into v_handoff;

  update atlas.tasks
  set assigned_membership_id = v_owner_membership_id,
      visibility_scope = 'assigned_worker',
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'assignee_key','owner',
        'owner_problem_handoff_open',true,
        'owner_problem_handoff_id',v_handoff.id,
        'owner_problem_handoff_issue',v_issue,
        'owner_problem_handoff_opened_at',v_handoff.opened_at,
        'owner_problem_handoff_original_assignee_key',v_original_assignee_key
      ),
      updated_at = now()
  where id = v_task.id;

  return jsonb_build_object(
    'handoffId',v_handoff.id,
    'taskId',v_task.id,
    'status','open',
    'message','Problem sent to the Owner. This task is off your schedule until it is sent back.',
    'deduplicated',false
  );
end;
$$;

create or replace function atlas.owner_resolve_task_problem_handoff_v1(
  p_task_id uuid,
  p_owner_response text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_handoff atlas.task_problem_handoffs%rowtype;
  v_existing atlas.task_problem_handoffs%rowtype;
  v_response text := nullif(btrim(coalesce(p_owner_response,'')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')), '');
  v_owner_membership_id uuid;
  v_transition jsonb;
  v_outcome_event_id uuid;
begin
  if p_task_id is null or v_key is null then
    raise exception 'Task and idempotency key are required.' using errcode = '22023';
  end if;
  if v_response is not null and length(v_response) > 2000 then
    raise exception 'Owner response must be 2000 characters or fewer.' using errcode = '22023';
  end if;

  select * into v_task
  from atlas.tasks
  where id = p_task_id
  for update;

  if v_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  if not atlas.is_farm_owner(v_task.farm_id) then
    raise exception 'Owner membership required.' using errcode = '42501';
  end if;

  v_owner_membership_id := atlas.current_membership_id(v_task.farm_id);

  select * into v_existing
  from atlas.task_problem_handoffs
  where farm_id = v_task.farm_id
    and resolution_idempotency_key = v_key
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'handoffId',v_existing.id,
      'taskId',v_existing.task_id,
      'status',v_existing.status,
      'message','Task already sent back.',
      'deduplicated',true
    );
  end if;

  select * into v_handoff
  from atlas.task_problem_handoffs
  where task_id = v_task.id
    and status = 'open'
  order by opened_at desc
  limit 1
  for update;

  if v_handoff.id is null then
    raise exception 'No open worker problem was found for this task.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_task.farm_id::text || ':problem-handoff:' || v_task.id::text,0));

  v_transition := atlas.record_task_transition_v1(
    v_task.id,
    'checklist_open',
    'problem-handoff-resolve:' || v_key,
    null,
    null,
    null,
    coalesce(v_task.action_key,'problem'),
    'owner_resolution',
    jsonb_build_object(
      'source','owner_problem_resolution',
      'handoff_id',v_handoff.id,
      'issue_text',v_handoff.issue_text,
      'owner_response',v_response
    ),
    null
  );

  begin
    v_outcome_event_id := nullif(v_transition ->> 'taskOutcomeEventId','')::uuid;
  exception when others then
    v_outcome_event_id := null;
  end;

  if v_outcome_event_id is not null then
    update atlas.task_outcome_events
    set note = coalesce(v_response,'Owner sent this task back to Anna.'),
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'problem_handoff_id',v_handoff.id,
          'issue_text',v_handoff.issue_text,
          'owner_response',v_response
        )
    where id = v_outcome_event_id;
  end if;

  update atlas.task_problem_handoffs
  set status = 'resolved',
      resolved_by_user_id = auth.uid(),
      resolved_by_membership_id = v_owner_membership_id,
      resolved_at = now(),
      owner_response = v_response,
      resolution_idempotency_key = v_key,
      metadata = metadata || jsonb_build_object('resolution_transition_id',v_transition ->> 'transitionId')
  where id = v_handoff.id;

  update atlas.tasks
  set assigned_membership_id = v_handoff.original_assigned_membership_id,
      visibility_scope = coalesce(v_handoff.original_visibility_scope,'assigned_worker'),
      metadata = (coalesce(metadata,'{}'::jsonb)
        - 'owner_problem_handoff_open'
        - 'owner_problem_handoff_issue'
        - 'owner_problem_handoff_opened_at')
        || jsonb_build_object(
          'assignee_key',coalesce(v_handoff.original_assignee_key,'anna'),
          'owner_problem_handoff_open',false,
          'last_owner_problem_handoff',jsonb_build_object(
            'id',v_handoff.id,
            'issue_text',v_handoff.issue_text,
            'owner_response',v_response,
            'resolved_at',now()
          )
        ),
      updated_at = now()
  where id = v_task.id;

  update atlas.object_state os
  set decision_required = false,
      metadata = os.metadata || jsonb_build_object(
        'last_problem_handoff_id',v_handoff.id,
        'last_problem_handoff_resolved_at',now()
      ),
      updated_at = now()
  where os.object_id in (
    select tro.object_id from atlas.task_objects tro where tro.task_id = v_task.id
  );

  return jsonb_build_object(
    'handoffId',v_handoff.id,
    'taskId',v_task.id,
    'status','resolved',
    'message','Resolved and sent back to Anna. The original due date is unchanged.',
    'deduplicated',false
  );
end;
$$;

revoke all on table atlas.task_problem_handoffs from public,anon,authenticated;
grant select on table atlas.task_problem_handoffs to authenticated,service_role;

revoke all on function atlas.worker_open_task_problem_handoff_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function atlas.owner_resolve_task_problem_handoff_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function atlas.worker_open_task_problem_handoff_v1(uuid,text,text) to authenticated,service_role;
grant execute on function atlas.owner_resolve_task_problem_handoff_v1(uuid,text,text) to authenticated,service_role;
