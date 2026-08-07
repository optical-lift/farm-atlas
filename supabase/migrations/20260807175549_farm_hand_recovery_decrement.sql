create or replace function atlas.consume_worker_recovery_move_v1(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_task atlas.tasks%rowtype;
  v_membership_id uuid;
  v_work_date date;
  v_state atlas.worker_day_states%rowtype;
  v_remaining integer;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  if v_membership_id is null or v_membership_id <> v_task.assigned_membership_id then
    raise exception 'This task is not assigned to the signed-in farm member.' using errcode='42501';
  end if;
  v_work_date := (now() at time zone 'America/Chicago')::date;

  select * into v_state from atlas.worker_day_states
  where worker_membership_id=v_membership_id and work_date=v_work_date
  for update;

  if v_state.id is null or v_state.mode <> 'recovery' then
    return jsonb_build_object('mode','normal','recoveryMovesRemaining',0);
  end if;

  v_remaining := greatest(v_state.recovery_moves_remaining-1,0);
  update atlas.worker_day_states
  set recovery_moves_remaining=v_remaining,
      mode=case when v_remaining=0 then 'normal' else 'recovery' end,
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'last_recovery_success_task_id',p_task_id,'last_recovery_success_at',now())
  where id=v_state.id;

  return jsonb_build_object('mode',case when v_remaining=0 then 'normal' else 'recovery' end,
    'recoveryMovesRemaining',v_remaining);
end;
$$;

revoke execute on function atlas.consume_worker_recovery_move_v1(uuid) from public, anon;
grant execute on function atlas.consume_worker_recovery_move_v1(uuid) to authenticated;
