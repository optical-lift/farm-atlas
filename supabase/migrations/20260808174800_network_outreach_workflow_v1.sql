create or replace function atlas.record_network_outreach_result_v1(
  p_task_id uuid,
  p_contact_result text,
  p_reached_name text,
  p_group_type text,
  p_contact_details text,
  p_follow_up text,
  p_booking_date date,
  p_booking_start time without time zone,
  p_expected_group_size integer,
  p_restroom_disclosed boolean,
  p_notes text,
  p_effective_membership_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_role text;
  v_booking_end time without time zone;
  v_program_id uuid;
  v_event_id uuid;
  v_conflict_id uuid;
  v_stable_key text;
  v_church_name text;
  v_result jsonb;
begin
  if p_contact_result not in ('interested','maybe','not_interested','voicemail','no_answer','wrong_contact') then
    raise exception using errcode = '22023', message = 'Choose what happened on the call.';
  end if;

  if p_expected_group_size is not null and (p_expected_group_size < 1 or p_expected_group_size > 250) then
    raise exception using errcode = '22023', message = 'Expected group size must be between 1 and 250.';
  end if;

  select * into v_task
  from atlas.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Outreach task not found.';
  end if;

  if coalesce(v_task.metadata->>'subtask_kind','') <> 'network_outreach_contact' then
    raise exception using errcode = '22023', message = 'This task is not a network outreach contact.';
  end if;

  select role into v_role
  from atlas.farm_memberships
  where id = p_effective_membership_id
    and farm_id = v_task.farm_id
    and active = true;

  if v_role is null then
    raise exception using errcode = '42501', message = 'No active farm membership is available.';
  end if;

  if p_effective_membership_id is distinct from v_task.assigned_membership_id
     and v_role not in ('owner','manager') then
    raise exception using errcode = '42501', message = 'This outreach contact belongs to another worker.';
  end if;

  v_stable_key := 'church_group_visit_' || replace(v_task.id::text, '-', '');
  v_church_name := coalesce(nullif(v_task.metadata->>'church_name',''), nullif(v_task.metadata->>'checklist_label',''), 'Church group');

  if p_booking_date is not null or p_booking_start is not null then
    if p_booking_date is null or p_booking_start is null then
      raise exception using errcode = '22023', message = 'Choose both a Thursday and a time.';
    end if;

    if extract(isodow from p_booking_date) <> 4 then
      raise exception using errcode = '22023', message = 'Church visits can only be booked on a Thursday.';
    end if;

    v_booking_end := case p_booking_start
      when time '09:30' then time '11:00'
      when time '11:30' then time '13:00'
      when time '13:30' then time '15:00'
      when time '15:30' then time '17:00'
      else null
    end;

    if v_booking_end is null then
      raise exception using errcode = '22023', message = 'Choose one of Elm’s Thursday visit times.';
    end if;

    if p_contact_result not in ('interested','maybe') then
      raise exception using errcode = '22023', message = 'Only an interested or follow-up group can be booked.';
    end if;

    if coalesce(p_restroom_disclosed, false) is not true then
      raise exception using errcode = '22023', message = 'Confirm the outdoor-only restroom limitation before booking.';
    end if;

    select ce.id into v_conflict_id
    from atlas.community_events ce
    where ce.farm_id = v_task.farm_id
      and ce.event_kind = 'church_group_visit'
      and ce.event_date = p_booking_date
      and ce.start_local_time = p_booking_start
      and ce.stable_key <> v_stable_key
      and ce.status <> 'cancelled'
    limit 1;

    if v_conflict_id is not null then
      raise exception using errcode = 'P0003', message = 'That Thursday time is already booked for another church group.';
    end if;

    select cp.id into v_program_id
    from atlas.community_programs cp
    where cp.farm_id = v_task.farm_id
      and cp.stable_key = 'thursdays_at_elm'
    limit 1;

    if v_program_id is null then
      raise exception using errcode = 'P0002', message = 'Thursdays at Elm is not configured.';
    end if;

    insert into atlas.community_events (
      farm_id,
      program_id,
      stable_key,
      title,
      event_kind,
      event_date,
      start_local_time,
      end_local_time,
      timezone_name,
      status,
      visibility_scope,
      capacity,
      metadata
    ) values (
      v_task.farm_id,
      v_program_id,
      v_stable_key,
      v_church_name || ' · Elm Farm visit',
      'church_group_visit',
      p_booking_date,
      p_booking_start,
      v_booking_end,
      'America/Chicago',
      'scheduled',
      'farm_shared',
      p_expected_group_size,
      jsonb_build_object(
        'source','network_outreach',
        'source_task_id',v_task.id,
        'source_parent_task_id',v_task.parent_task_id,
        'church_name',v_church_name,
        'group_type',nullif(btrim(coalesce(p_group_type,'')),''),
        'contact_name',nullif(btrim(coalesce(p_reached_name,'')),''),
        'contact_details',nullif(btrim(coalesce(p_contact_details,'')),''),
        'follow_up',nullif(btrim(coalesce(p_follow_up,'')),''),
        'expected_group_size',p_expected_group_size,
        'outdoor_only',true,
        'free_use',true,
        'guest_restroom_available',false,
        'restroom_disclosed',true,
        'notes',nullif(btrim(coalesce(p_notes,'')),'')
      )
    )
    on conflict (farm_id, stable_key) do update
    set program_id = excluded.program_id,
        title = excluded.title,
        event_kind = excluded.event_kind,
        event_date = excluded.event_date,
        start_local_time = excluded.start_local_time,
        end_local_time = excluded.end_local_time,
        timezone_name = excluded.timezone_name,
        status = excluded.status,
        visibility_scope = excluded.visibility_scope,
        capacity = excluded.capacity,
        metadata = excluded.metadata,
        updated_at = now()
    returning id into v_event_id;
  else
    update atlas.community_events
    set status = 'cancelled',
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'cancelled_reason','outreach_result_no_longer_has_booking',
          'cancelled_at',now()
        ),
        updated_at = now()
    where farm_id = v_task.farm_id
      and stable_key = v_stable_key
      and status <> 'cancelled';
  end if;

  v_result := jsonb_build_object(
    'contact_result',p_contact_result,
    'reached_name',nullif(btrim(coalesce(p_reached_name,'')),''),
    'group_type',nullif(btrim(coalesce(p_group_type,'')),''),
    'contact_details',nullif(btrim(coalesce(p_contact_details,'')),''),
    'follow_up',nullif(btrim(coalesce(p_follow_up,'')),''),
    'notes',nullif(btrim(coalesce(p_notes,'')),''),
    'booking_date',p_booking_date,
    'booking_start',p_booking_start,
    'booking_end',v_booking_end,
    'expected_group_size',p_expected_group_size,
    'restroom_disclosed',case when p_booking_date is null then null else coalesce(p_restroom_disclosed,false) end,
    'community_event_id',v_event_id,
    'recorded_at',now()
  );

  update atlas.tasks
  set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('network_outreach_result',v_result),
      updated_at = now()
  where id = v_task.id;

  return jsonb_build_object(
    'ok',true,
    'taskId',v_task.id,
    'eventId',v_event_id,
    'result',v_result
  );
end;
$$;

create or replace function atlas.release_network_outreach_batch_v1(
  p_task_id uuid,
  p_next_task_key text,
  p_effective_membership_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_next atlas.tasks%rowtype;
  v_role text;
  v_incomplete integer;
  v_released_children integer := 0;
  v_now timestamptz := now();
  v_idempotency_key text;
begin
  if nullif(btrim(coalesce(p_next_task_key,'')),'') is null then
    raise exception using errcode = '22023', message = 'Next outreach batch is required.';
  end if;

  select * into v_task
  from atlas.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Outreach batch not found.';
  end if;

  select role into v_role
  from atlas.farm_memberships
  where id = p_effective_membership_id
    and farm_id = v_task.farm_id
    and active = true;

  if v_role is null then
    raise exception using errcode = '42501', message = 'No active farm membership is available.';
  end if;

  if p_effective_membership_id is distinct from v_task.assigned_membership_id
     and v_role not in ('owner','manager') then
    raise exception using errcode = '42501', message = 'This outreach batch belongs to another worker.';
  end if;

  if coalesce(v_task.metadata->>'checklist_mode','') <> 'network_outreach' then
    raise exception using errcode = '22023', message = 'This is not a network outreach batch.';
  end if;

  if v_task.status <> 'done' then
    raise exception using errcode = '22023', message = 'Finish this outreach batch before releasing the next one.';
  end if;

  select count(*) into v_incomplete
  from atlas.tasks child
  where child.parent_task_id = v_task.id
    and child.status not in ('done','archived');

  if v_incomplete > 0 then
    raise exception using errcode = '22023', message = 'Record a result for every outreach contact first.';
  end if;

  select * into v_next
  from atlas.tasks t
  where t.farm_id = v_task.farm_id
    and t.metadata->>'task_key' = p_next_task_key
  order by t.created_at desc
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Next outreach batch not found.';
  end if;

  if v_next.status <> 'open' then
    update atlas.tasks
    set status = 'open',
        blocker_text = null,
        released_at = v_now,
        release_reason = 'previous_network_outreach_batch_complete',
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'prerequisite_gate_state','released',
          'prerequisite_released_at',v_now,
          'prerequisite_source_task_id',v_task.id
        ),
        updated_at = v_now
    where id = v_next.id;

    update atlas.tasks
    set status = 'open',
        blocker_text = null,
        released_at = coalesce(released_at,v_now),
        release_reason = coalesce(release_reason,'parent_network_outreach_batch_released'),
        updated_at = v_now
    where parent_task_id = v_next.id
      and status = 'blocked';
    get diagnostics v_released_children = row_count;

    v_idempotency_key := v_next.id::text || ':network-outreach-release:' || v_task.id::text;
    insert into atlas.task_transitions (
      farm_id,
      task_id,
      transition,
      previous_status,
      next_status,
      action_key,
      work_class,
      reason,
      idempotency_key,
      payload,
      created_by,
      actor_membership_id,
      actor_role,
      created_at
    ) values (
      v_task.farm_id,
      v_next.id,
      'released',
      v_next.status,
      'open',
      coalesce(v_next.action_key,'network'),
      coalesce(v_next.work_class,'standard'),
      'Previous network outreach batch completed',
      v_idempotency_key,
      jsonb_build_object(
        'source_task_id',v_task.id,
        'release_source','network_outreach_sequence',
        'released_children',v_released_children
      ),
      'network_outreach_sequence',
      p_effective_membership_id,
      v_role,
      v_now
    ) on conflict (farm_id,idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'ok',true,
    'sourceTaskId',v_task.id,
    'nextTaskId',v_next.id,
    'releasedChildren',v_released_children,
    'alreadyOpen',v_next.status = 'open'
  );
end;
$$;

revoke all on function atlas.record_network_outreach_result_v1(uuid,text,text,text,text,text,date,time without time zone,integer,boolean,text,uuid) from public, anon;
revoke all on function atlas.release_network_outreach_batch_v1(uuid,text,uuid) from public, anon;
grant execute on function atlas.record_network_outreach_result_v1(uuid,text,text,text,text,text,date,time without time zone,integer,boolean,text,uuid) to authenticated, service_role;
grant execute on function atlas.release_network_outreach_batch_v1(uuid,text,uuid) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  registered_at,
  reviewed_at
) values
(
  'atlas.record_network_outreach_result_v1(uuid,text,text,text,text,text,date,time without time zone,integer,boolean,text,uuid)',
  'app_endpoint','verified','active',true,true,true,1,3,
  jsonb_build_object(
    'source','network_outreach_workflow_v1',
    'call_site','Network outreach contact checklist',
    'authorization','assigned worker or owner/manager with active membership on task farm',
    'writes','structured outreach result plus Thursdays at Elm community event',
    'reviewed_date','2026-08-08'
  ),now(),now()
),
(
  'atlas.release_network_outreach_batch_v1(uuid,text,uuid)',
  'app_endpoint','verified','active',true,true,true,1,3,
  jsonb_build_object(
    'source','network_outreach_workflow_v1',
    'call_site','Network outreach batch completion',
    'authorization','assigned worker or owner/manager with active membership on task farm',
    'writes','releases the prebuilt next outreach batch after all child results are complete',
    'reviewed_date','2026-08-08'
  ),now(),now()
)
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    caller_count = excluded.caller_count,
    policy_reference_count = excluded.policy_reference_count,
    evidence = coalesce(atlas.authenticated_rpc_registry.evidence,'{}'::jsonb) || excluded.evidence,
    reviewed_at = excluded.reviewed_at;
