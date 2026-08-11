-- Grow Room Care is a compact care/check round, not a second task-execution
-- surface. Substantive state transitions such as pot-up and hardening keep their
-- own canonical Task Focus so the worker sees full instructions, requirements,
-- blockers, and results. Internal readiness provenance remains cue-only.

create or replace function atlas.grow_room_round_v1(
  p_farm_id uuid,
  p_visit_task_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_visit atlas.tasks%rowtype;
  v_requests jsonb := '[]'::jsonb;
  v_unresolved integer := 0;
  v_resolved integer := 0;
  v_total integer := 0;
  v_membership_id uuid;
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;

  v_membership_id := atlas.current_membership_id(p_farm_id);

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
    with eligible as (
      select
        t.id,
        t.due_date,
        t.created_at,
        case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end as priority_rank,
        lower(coalesce(t.metadata ->> 'grow_room_round_linked', 'false')) in ('true', 'yes', '1')
          and nullif(t.metadata ->> 'grow_room_round_sequence_key', '') is not null as linked_sequence,
        nullif(t.metadata ->> 'grow_room_round_sequence_key', '') as sequence_key,
        case
          when coalesce(t.metadata ->> 'grow_room_round_sequence_order', '') ~ '^-?\d+$'
            then (t.metadata ->> 'grow_room_round_sequence_order')::integer
          else 999999
        end as sequence_order
      from atlas.tasks t
      left join atlas.zones z on z.id = t.zone_id
      where t.farm_id = p_farm_id
        and t.id <> v_visit.id
        and t.status in ('open', 'blocked')
        and t.visibility_scope <> 'system_internal'
        and coalesce(t.due_date, v_visit.due_date) <= coalesce(v_visit.due_date, current_date)
        and t.parent_task_id is null
        and (
          v_visit.assigned_membership_id is null
          or t.assigned_membership_id is null
          or t.assigned_membership_id = v_visit.assigned_membership_id
        )
        and (
          t.task_type in ('germination_check', 'grow_room_check')
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
          or coalesce(t.metadata ->> 'work_route', '') = 'grow_room_check'
        )
    ), linked as (
      select *
      from eligible
      where linked_sequence
    ), ordinary as (
      select
        eligible.*,
        row_number() over (
          order by due_date nulls last, priority_rank, created_at
        ) as ordinary_rank
      from eligible
      where not linked_sequence
    ), candidate as (
      select id, due_date, created_at, priority_rank, sequence_key, sequence_order, true as linked_sequence
      from linked

      union all

      select id, due_date, created_at, priority_rank, sequence_key, sequence_order, false as linked_sequence
      from ordinary
      where ordinary_rank <= 3
        and not exists (select 1 from linked)
    )
    insert into atlas.grow_room_round_requests (
      farm_id, visit_task_id, request_task_id, sort_order, metadata
    )
    select
      p_farm_id,
      v_visit.id,
      candidate.id,
      row_number() over (
        order by
          case when candidate.linked_sequence then 0 else 1 end,
          candidate.due_date nulls last,
          candidate.sequence_order,
          candidate.priority_rank,
          candidate.created_at
      )::integer,
      jsonb_strip_nulls(jsonb_build_object(
        'release_source', 'grow_room_round_v1',
        'round_due_date', v_visit.due_date,
        'linked_sequence', candidate.linked_sequence,
        'sequence_key', candidate.sequence_key
      ))
    from candidate
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
      'standResponseOptions', t.metadata -> 'stand_response_options',
      'sequenceKey', nullif(t.metadata ->> 'grow_room_round_sequence_key', ''),
      'sequenceLabel', nullif(t.metadata ->> 'grow_room_round_sequence_label', '')
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
      'maximumOrdinaryRequests', 3,
      'linkedSequenceTasksVisible', true,
      'futureWorkVisible', false,
      'infrastructureEditable', false,
      'wateringLogged', false
    )
  );
end;
$function$;

-- Existing round rows are choreography, not task truth. Remove unresolved links
-- that now belong on their own Task Focus (or, for internal readiness, in cues).
-- This makes those still-open tasks eligible for their canonical Day surface.
delete from atlas.grow_room_round_requests rr
using atlas.tasks request_task
where request_task.id = rr.request_task_id
  and rr.resolved_at is null
  and (
    request_task.visibility_scope = 'system_internal'
    or request_task.task_type in ('pot_up', 'hardening_off', 'transplant_readiness', 'propagation_readiness')
  );
