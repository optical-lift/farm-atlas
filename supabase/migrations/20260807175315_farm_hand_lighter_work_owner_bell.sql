create or replace function atlas.report_worker_needs_lighter_work_v1(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_task atlas.tasks%rowtype;
  v_event_id uuid;
  v_work_date date;
  v_current_membership_id uuid;
  v_role text;
  v_owner record;
  v_push_id uuid;
begin
  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then raise exception 'Task not found'; end if;
  if v_task.assigned_membership_id is null then raise exception 'Task has no assigned worker'; end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_current_membership_id := atlas.current_membership_id(v_task.farm_id);
  if v_role is null or v_current_membership_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;
  if v_current_membership_id <> v_task.assigned_membership_id then
    raise exception 'Worker may only report lighter work for their own assigned task.' using errcode = '42501';
  end if;

  v_work_date := (now() at time zone 'America/Chicago')::date;
  insert into atlas.worker_support_events(farm_id,worker_membership_id,task_id,event_type,event_context)
  values (v_task.farm_id,v_task.assigned_membership_id,v_task.id,'need_lighter_work',
    jsonb_build_object('task_title',v_task.title,'work_class',v_task.work_class,'work_lane',v_task.work_lane,'reported_at',now()))
  returning id into v_event_id;

  insert into atlas.worker_day_states(farm_id,worker_membership_id,work_date,mode,recovery_moves_remaining,last_support_event_id,metadata)
  values (v_task.farm_id,v_task.assigned_membership_id,v_work_date,'recovery',2,v_event_id,
    jsonb_build_object('entered_at',now(),'excluded_task_id',v_task.id))
  on conflict (worker_membership_id,work_date) do update
    set mode='recovery', recovery_moves_remaining=greatest(atlas.worker_day_states.recovery_moves_remaining,2),
        last_support_event_id=excluded.last_support_event_id,
        metadata=coalesce(atlas.worker_day_states.metadata,'{}'::jsonb)||jsonb_build_object('entered_at',now(),'excluded_task_id',v_task.id),
        updated_at=now();

  update atlas.tasks set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'lighter_work_reported_at',now(),'lighter_work_support_event_id',v_event_id,'lighter_work_state','reported'), updated_at=now()
  where id=v_task.id;

  for v_owner in
    select fm.user_id from atlas.farm_memberships fm
    where fm.farm_id=v_task.farm_id and fm.active and fm.role='owner' and fm.user_id is not null
  loop
    v_push_id := atlas.enqueue_direct_push_v1(
      v_task.farm_id,
      v_owner.user_id,
      'worker_support',
      'Anna needed lighter work',
      v_task.title,
      '/bell',
      'worker-support:'||v_event_id::text||':'||v_owner.user_id::text,
      'normal',
      now(),
      jsonb_build_object('workerSupportEventId',v_event_id,'taskId',v_task.id,'eventType','need_lighter_work')
    );
  end loop;

  return jsonb_build_object('eventId',v_event_id,'workerMembershipId',v_task.assigned_membership_id,
    'taskId',v_task.id,'mode','recovery','recoveryMovesRemaining',2);
end;
$$;

revoke execute on function atlas.report_worker_needs_lighter_work_v1(uuid) from public, anon;
grant execute on function atlas.report_worker_needs_lighter_work_v1(uuid) to authenticated;

update atlas.authenticated_rpc_registry
set evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
      'owner_bell_wired',true,
      'source','farm_hand_lighter_work_owner_bell',
      'reviewed_date','2026-08-07'
    ),
    reviewed_at=now()
where signature='atlas.report_worker_needs_lighter_work_v1(uuid)';
