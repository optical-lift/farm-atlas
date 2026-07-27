create table if not exists atlas.grow_room_round_requests (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  visit_task_id uuid not null references atlas.tasks(id) on delete cascade,
  request_task_id uuid not null references atlas.tasks(id) on delete cascade,
  sort_order integer not null check (sort_order between 1 and 3),
  released_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_key text,
  resolution_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  unique (visit_task_id, request_task_id),
  unique (visit_task_id, sort_order)
);

create index if not exists grow_room_round_requests_farm_visit_idx
  on atlas.grow_room_round_requests(farm_id, visit_task_id, sort_order);

alter table atlas.grow_room_round_requests enable row level security;

drop policy if exists grow_room_round_requests_member_read on atlas.grow_room_round_requests;
create policy grow_room_round_requests_member_read
  on atlas.grow_room_round_requests
  for select
  to authenticated
  using (atlas.is_farm_member(farm_id));

update atlas.tasks
set action_key = 'grow_room_round',
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'portal_href', '/grow-room',
        'ordinary_care_not_logged', true,
        'round_completion_required', true
      ),
    updated_at = now()
where task_type = 'grow_room_care'
  and status in ('open', 'blocked')
  and lower(title) in ('grow room care', 'water + check grow room', 'check grow room')
  and lower(coalesce(action_key, '')) in ('water', 'watered', 'watering', 'moisture_check');

update atlas.planned_work_occurrences
set task_payload = jsonb_set(
      coalesce(task_payload, '{}'::jsonb),
      '{action_key}',
      to_jsonb('grow_room_round'::text),
      true
    ),
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('ordinary_care_not_logged', true, 'round_completion_required', true),
    updated_at = now()
where lower(title) in ('grow room care', 'water + check grow room', 'check grow room')
  and lower(coalesce(task_payload ->> 'action_key', '')) in ('water', 'watered', 'watering', 'moisture_check');

create or replace function atlas.grow_room_round_v1(
  p_farm_id uuid,
  p_visit_task_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_visit atlas.tasks%rowtype;
  v_requests jsonb := '[]'::jsonb;
  v_unresolved integer := 0;
  v_resolved integer := 0;
  v_total integer := 0;
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;

  if p_visit_task_id is not null then
    select t.* into v_visit
    from atlas.tasks t
    where t.id = p_visit_task_id
      and t.farm_id = p_farm_id
      and t.task_type = 'grow_room_care'
      and lower(t.title) in ('grow room care', 'water + check grow room', 'check grow room')
    limit 1;

    if v_visit.id is null then
      raise exception 'Grow Room Care task not found.' using errcode = 'P0002';
    end if;
  else
    select t.* into v_visit
    from atlas.tasks t
    where t.farm_id = p_farm_id
      and t.task_type = 'grow_room_care'
      and lower(t.title) in ('grow room care', 'water + check grow room', 'check grow room')
      and t.status in ('open', 'blocked')
    order by
      case when t.due_date = current_date then 0 when t.due_date > current_date then 1 else 2 end,
      abs(coalesce(t.due_date, current_date) - current_date),
      t.created_at
    limit 1;
  end if;

  if v_visit.id is null then
    return jsonb_build_object(
      'visitTask', null,
      'requests', '[]'::jsonb,
      'summary', jsonb_build_object('total', 0, 'resolved', 0, 'unresolved', 0, 'canFinish', false)
    );
  end if;

  if not exists (
    select 1 from atlas.grow_room_round_requests rr where rr.visit_task_id = v_visit.id
  ) and v_visit.status in ('open', 'blocked') then
    insert into atlas.grow_room_round_requests (
      farm_id, visit_task_id, request_task_id, sort_order, metadata
    )
    select
      p_farm_id,
      v_visit.id,
      candidate.id,
      row_number() over (order by candidate.due_date nulls last, candidate.priority_rank, candidate.created_at)::integer,
      jsonb_build_object('release_source', 'grow_room_round_v1', 'round_due_date', v_visit.due_date)
    from (
      select
        t.id,
        t.due_date,
        t.created_at,
        case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end as priority_rank
      from atlas.tasks t
      left join atlas.zones z on z.id = t.zone_id
      where t.farm_id = p_farm_id
        and t.id <> v_visit.id
        and t.status in ('open', 'blocked')
        and coalesce(t.due_date, v_visit.due_date) <= coalesce(v_visit.due_date, current_date)
        and t.parent_task_id is null
        and (
          v_visit.assigned_membership_id is null
          or t.assigned_membership_id is null
          or t.assigned_membership_id = v_visit.assigned_membership_id
        )
        and (
          t.task_type in (
            'germination_check', 'grow_room_check', 'pot_up', 'hardening_off',
            'transplant_readiness', 'propagation_readiness'
          )
          or (
            t.task_type = 'grow_room_care'
            and lower(coalesce(t.action_key, '')) not in (
              'water', 'watered', 'watering', 'moisture_check', 'grow_room_round'
            )
          )
        )
        and (
          z.stable_key = 'grow_room'
          or coalesce(t.metadata ->> 'collection_zone', '') ilike '%grow room%'
          or coalesce(t.metadata ->> 'location_label', '') ilike '%grow room%'
          or coalesce(t.metadata ->> 'work_route', '') in (
            'grow_room_check', 'pot_up', 'hardening_off', 'transplant_readiness'
          )
        )
      order by t.due_date nulls last, priority_rank, t.created_at
      limit 3
    ) candidate
    on conflict do nothing;
  end if;

  update atlas.grow_room_round_requests rr
  set resolved_at = coalesce(rr.resolved_at, now()),
      resolution_key = coalesce(rr.resolution_key, 'resolved_elsewhere')
  from atlas.tasks t
  where rr.visit_task_id = v_visit.id
    and rr.request_task_id = t.id
    and rr.resolved_at is null
    and t.status not in ('open', 'blocked');

  select
    count(*)::integer,
    count(*) filter (where rr.resolved_at is not null)::integer,
    count(*) filter (where rr.resolved_at is null)::integer
  into v_total, v_resolved, v_unresolved
  from atlas.grow_room_round_requests rr
  where rr.visit_task_id = v_visit.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignmentId', rr.id,
    'taskId', t.id,
    'title', t.title,
    'taskType', t.task_type,
    'actionKey', t.action_key,
    'status', t.status,
    'dueDate', t.due_date,
    'priority', t.priority,
    'sortOrder', rr.sort_order,
    'resolvedAt', rr.resolved_at,
    'resolutionKey', rr.resolution_key,
    'requestKind', case
      when t.task_type = 'germination_check' or lower(t.title) like '%germination%' then 'germination'
      when t.task_type = 'pot_up' or lower(t.title) like '%pot up%' then 'pot_up'
      when t.task_type = 'hardening_off' or lower(t.title) like '%harden%' then 'hardening'
      when t.task_type in ('transplant_readiness', 'propagation_readiness') then 'readiness'
      else 'care_action'
    end,
    'displayAction', coalesce(nullif(t.metadata ->> 'display_action', ''), 'Complete'),
    'displaySubject', coalesce(nullif(t.metadata ->> 'display_subject', ''), nullif(t.metadata ->> 'collection_label', ''), t.title),
    'displayDetail', coalesce(nullif(t.metadata ->> 'display_detail', ''), nullif(t.metadata ->> 'container_kind', '')),
    'metadata', jsonb_strip_nulls(jsonb_build_object(
      'cropLabel', nullif(t.metadata ->> 'crop_label', ''),
      'containerKind', nullif(t.metadata ->> 'container_kind', ''),
      'standResponseOptions', t.metadata -> 'stand_response_options'
    ))
  ) order by rr.sort_order), '[]'::jsonb)
  into v_requests
  from atlas.grow_room_round_requests rr
  join atlas.tasks t on t.id = rr.request_task_id
  where rr.visit_task_id = v_visit.id;

  return jsonb_build_object(
    'visitTask', jsonb_build_object(
      'taskId', v_visit.id,
      'title', v_visit.title,
      'status', v_visit.status,
      'dueDate', v_visit.due_date,
      'workOrder', coalesce(v_visit.metadata ->> 'work_order', v_visit.metadata ->> 'day_work_order', '1')
    ),
    'requests', v_requests,
    'summary', jsonb_build_object(
      'total', v_total,
      'resolved', v_resolved,
      'unresolved', v_unresolved,
      'canFinish', v_visit.status in ('open', 'blocked') and v_unresolved = 0
    ),
    'rules', jsonb_build_object(
      'maximumReleasedRequests', 3,
      'futureWorkVisible', false,
      'infrastructureEditable', false,
      'wateringLogged', false
    )
  );
end;
$$;

create or replace function atlas.grow_room_resolve_round_request_v1(
  p_farm_id uuid,
  p_visit_task_id uuid,
  p_request_task_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_target_date date default null,
  p_note text default null,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_assignment atlas.grow_room_round_requests%rowtype;
  v_role text;
  v_result jsonb;
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;

  if p_transition not in ('done', 'blocked', 'rescheduled', 'unfinished') then
    raise exception 'Unsupported Grow Room request result.' using errcode = '22023';
  end if;

  if p_transition in ('rescheduled', 'unfinished') and p_target_date is null then
    raise exception 'A new date is required.' using errcode = '22023';
  end if;

  select rr.* into v_assignment
  from atlas.grow_room_round_requests rr
  where rr.farm_id = p_farm_id
    and rr.visit_task_id = p_visit_task_id
    and rr.request_task_id = p_request_task_id
  for update;

  if v_assignment.id is null then
    raise exception 'Grow Room request not found.' using errcode = 'P0002';
  end if;

  if v_assignment.resolved_at is not null then
    return jsonb_build_object(
      'ok', true,
      'deduplicated', true,
      'requestTaskId', p_request_task_id,
      'resolutionKey', v_assignment.resolution_key
    );
  end if;

  v_role := atlas.current_farm_role(p_farm_id);

  if v_role = 'owner' then
    v_result := atlas.owner_record_task_transition_v1(
      p_request_task_id,
      p_transition,
      p_idempotency_key,
      p_target_date,
      p_note,
      p_reason,
      null,
      null,
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('source_surface', 'grow_room_round'),
      null
    );
  else
    v_result := atlas.worker_record_task_transition_v1(
      p_request_task_id,
      p_transition,
      p_idempotency_key,
      p_note,
      p_reason,
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('source_surface', 'grow_room_round'),
      p_target_date,
      null,
      null,
      null
    );
  end if;

  update atlas.grow_room_round_requests
  set resolved_at = now(),
      resolution_key = p_transition,
      resolution_payload = coalesce(p_payload, '{}'::jsonb),
      metadata = metadata || jsonb_build_object('transition_result', v_result)
  where id = v_assignment.id;

  return jsonb_build_object(
    'ok', true,
    'deduplicated', false,
    'requestTaskId', p_request_task_id,
    'resolutionKey', p_transition,
    'transition', v_result
  );
end;
$$;

create or replace function atlas.grow_room_finish_round_v1(
  p_farm_id uuid,
  p_visit_task_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_visit atlas.tasks%rowtype;
  v_role text;
  v_unresolved integer;
  v_total integer;
  v_result jsonb;
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;

  select t.* into v_visit
  from atlas.tasks t
  where t.id = p_visit_task_id
    and t.farm_id = p_farm_id
    and t.task_type = 'grow_room_care'
  for update;

  if v_visit.id is null then
    raise exception 'Grow Room Care task not found.' using errcode = 'P0002';
  end if;

  select
    count(*) filter (where resolved_at is null)::integer,
    count(*)::integer
  into v_unresolved, v_total
  from atlas.grow_room_round_requests
  where visit_task_id = p_visit_task_id;

  if v_unresolved > 0 then
    raise exception 'Resolve today''s Grow Room requests before finishing the round.' using errcode = '22023';
  end if;

  if v_visit.status = 'done' then
    return jsonb_build_object('ok', true, 'deduplicated', true, 'taskId', p_visit_task_id, 'status', 'done');
  end if;

  v_role := atlas.current_farm_role(p_farm_id);

  if v_role = 'owner' then
    v_result := atlas.owner_record_task_transition_v1(
      p_visit_task_id,
      'done',
      p_idempotency_key,
      null,
      'Grow Room round finished.',
      null,
      'grow_room_round',
      'grow_room_round',
      jsonb_build_object(
        'source_surface', 'grow_room_round',
        'request_count', v_total,
        'ordinary_care_not_logged', true,
        'watering_logged', false
      ),
      null
    );
  else
    v_result := atlas.worker_record_task_transition_v1(
      p_visit_task_id,
      'done',
      p_idempotency_key,
      'Grow Room round finished.',
      null,
      jsonb_build_object(
        'source_surface', 'grow_room_round',
        'request_count', v_total,
        'ordinary_care_not_logged', true,
        'watering_logged', false
      ),
      null,
      'grow_room_round',
      'grow_room_round',
      null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'deduplicated', false,
    'taskId', p_visit_task_id,
    'status', 'done',
    'transition', v_result
  );
end;
$$;

grant execute on function atlas.grow_room_round_v1(uuid, uuid) to authenticated;
grant execute on function atlas.grow_room_resolve_round_request_v1(uuid, uuid, uuid, text, text, date, text, text, jsonb) to authenticated;
grant execute on function atlas.grow_room_finish_round_v1(uuid, uuid, text) to authenticated;
