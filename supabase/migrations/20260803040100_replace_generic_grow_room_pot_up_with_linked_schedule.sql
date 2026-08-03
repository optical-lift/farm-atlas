do $migration$
declare
  v_farm_id uuid;
  v_owner_user_id uuid;
  v_owner_membership_id uuid;
  v_generic_task_id uuid;
  v_source_task_id uuid;
  v_filtered_plan jsonb;
begin
  select f.id into v_farm_id
  from atlas.farms f
  where f.stable_key = 'elm_farm';

  select fm.user_id, fm.id
  into v_owner_user_id, v_owner_membership_id
  from atlas.farm_memberships fm
  where fm.farm_id = v_farm_id
    and fm.active = true
    and fm.role = 'owner'
  order by fm.created_at
  limit 1;

  select t.id
  into v_generic_task_id
  from atlas.tasks t
  where t.farm_id = v_farm_id
    and t.title = 'Grow Room — Pot Up Winter Greens + Scallions as Needed'
  order by t.created_at desc
  limit 1;

  if v_generic_task_id is not null
     and exists (
       select 1 from atlas.tasks t
       where t.id = v_generic_task_id and t.status in ('open', 'blocked')
     ) then
    perform atlas.record_task_transition_v1_internal(
      v_generic_task_id,
      'changed_plan',
      'replace-generic-grow-room-pot-up-with-crop-linked-schedule-v1',
      null,
      'The generic winter-greens pot-up step was removed. Grow Room Care now uses the existing crop-specific 200-cell potting schedule.',
      'Owner replaced this generic step with the previously created crop-linked potting tasks.',
      'grow_room_round',
      'pot_up',
      jsonb_build_object(
        'source_surface', 'owner_instruction',
        'replacement_schedule_key', 'crop_linked_200_cell_pot_up_schedule_20260810',
        'actor_user_id', v_owner_user_id,
        'actor_membership_id', v_owner_membership_id,
        'actor_role', 'owner'
      ),
      null
    );
  end if;

  if v_generic_task_id is not null then
    update atlas.planned_work_occurrences pwo
    set state = 'cancelled',
        metadata = coalesce(pwo.metadata, '{}'::jsonb) || jsonb_build_object(
          'cancelled_at', now(),
          'cancelled_reason', 'Replaced by the crop-linked 200-cell potting schedule.',
          'replacement_schedule_key', 'crop_linked_200_cell_pot_up_schedule_20260810',
          'cancelled_by_user_id', v_owner_user_id
        ),
        updated_at = now()
    where pwo.released_task_id = v_generic_task_id
      and pwo.state not in ('completed', 'cancelled');

    delete from atlas.grow_room_round_requests rr
    where rr.request_task_id = v_generic_task_id;
  end if;

  select t.id into v_source_task_id
  from atlas.tasks t
  where t.farm_id = v_farm_id
    and t.metadata ->> 'task_key' = 'anna_20260710_sow_winter_greens_scallions'
  limit 1;

  if v_source_task_id is not null then
    select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
    into v_filtered_plan
    from jsonb_array_elements(
      coalesce((select metadata -> 'followup_plan' from atlas.tasks where id = v_source_task_id), '[]'::jsonb)
    ) with ordinality as x(item, ord)
    where item ->> 'title' <> 'Grow Room — Pot Up Winter Greens + Scallions as Needed';

    update atlas.tasks t
    set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
          'followup_plan', v_filtered_plan,
          'generic_pot_up_removed_at', now(),
          'generic_pot_up_replaced_by_schedule_key', 'crop_linked_200_cell_pot_up_schedule_20260810'
        ),
        updated_at = now()
    where t.id = v_source_task_id;
  end if;

  update atlas.tasks t
  set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'grow_room_round_linked', true,
        'grow_room_round_sequence_key', 'crop_linked_200_cell_pot_up_schedule_20260810',
        'grow_room_round_sequence_label', 'Crop-linked 200-cell Pot Up',
        'grow_room_round_sequence_date', t.due_date,
        'grow_room_round_sequence_order',
          ((t.due_date - date '2026-08-10') * 100)
          + coalesce(nullif(t.metadata ->> 'day_work_order', '')::integer, 50),
        'grow_room_round_linked_at', now(),
        'grow_room_round_linked_by', 'owner_instruction_20260802'
      ),
      updated_at = now()
  where t.farm_id = v_farm_id
    and t.status in ('open', 'blocked')
    and t.metadata ->> 'schedule_batch_key' = 'crop_linked_200_cell_pot_up_schedule_20260810';

  update atlas.planned_work_occurrences pwo
  set task_payload = jsonb_set(
        coalesce(pwo.task_payload, '{}'::jsonb),
        '{metadata}',
        coalesce(pwo.task_payload -> 'metadata', '{}'::jsonb) || jsonb_build_object(
          'grow_room_round_linked', true,
          'grow_room_round_sequence_key', 'crop_linked_200_cell_pot_up_schedule_20260810',
          'grow_room_round_sequence_label', 'Crop-linked 200-cell Pot Up',
          'grow_room_round_sequence_date', t.due_date,
          'grow_room_round_sequence_order',
            ((t.due_date - date '2026-08-10') * 100)
            + coalesce(nullif(t.metadata ->> 'day_work_order', '')::integer, 50)
        ),
        true
      ),
      metadata = coalesce(pwo.metadata, '{}'::jsonb) || jsonb_build_object(
        'grow_room_round_sequence_key', 'crop_linked_200_cell_pot_up_schedule_20260810',
        'grow_room_round_linked_at', now()
      ),
      updated_at = now()
  from atlas.tasks t
  where pwo.released_task_id = t.id
    and t.farm_id = v_farm_id
    and t.status in ('open', 'blocked')
    and t.metadata ->> 'schedule_batch_key' = 'crop_linked_200_cell_pot_up_schedule_20260810';
end
$migration$;

create or replace function atlas.grow_room_round_v1(
  p_farm_id uuid,
  p_visit_task_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
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
