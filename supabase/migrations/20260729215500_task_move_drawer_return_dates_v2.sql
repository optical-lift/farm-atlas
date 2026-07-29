alter table atlas.task_day_dispositions
  add column if not exists requested_return_date date;

create or replace function atlas.set_task_aside_today_v2(
  p_task_id uuid,
  p_requested_return_date date,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_existing atlas.task_day_dispositions%rowtype;
  v_row atlas.task_day_dispositions%rowtype;
  v_role text;
  v_membership_id uuid;
  v_local_date date := timezone('America/Chicago', now())::date;
  v_requested_return date;
  v_returns_on date;
  v_safe_boundary date;
  v_clock_state text;
  v_overdue_days integer := 0;
  v_deferral_number integer := 1;
  v_consequence text;
  v_message text;
  v_event_id uuid;
  v_request_honored boolean;
begin
  if p_task_id is null or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Task and idempotency key are required.' using errcode = '22023';
  end if;

  v_requested_return := coalesce(p_requested_return_date, v_local_date + 1);
  if v_requested_return <= v_local_date then
    raise exception 'Choose tomorrow or a later date.' using errcode = '22023';
  end if;

  select * into v_existing
  from atlas.task_day_dispositions
  where idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    return jsonb_build_object(
      'contractVersion','task_set_aside_today_v2',
      'dispositionId',v_existing.id,
      'taskId',v_existing.task_id,
      'serviceDate',v_existing.service_date,
      'dueDate',v_existing.due_date_snapshot,
      'safeBoundaryDate',v_existing.safe_boundary_date,
      'requestedReturnDate',coalesce(v_existing.requested_return_date,v_existing.returns_on),
      'consequence',v_existing.consequence,
      'overdueDays',v_existing.overdue_days,
      'deferralCount',v_existing.deferral_number,
      'returnsOn',v_existing.returns_on,
      'requestHonored',coalesce(v_existing.requested_return_date,v_existing.returns_on)=v_existing.returns_on,
      'message',case
        when v_existing.consequence='at_risk' then 'Set aside for today. This work is at risk and returns tomorrow.'
        when v_existing.consequence='overdue' then 'Set aside for today. This work remains overdue and returns tomorrow.'
        when coalesce(v_existing.requested_return_date,v_existing.returns_on)<>v_existing.returns_on
          then 'Set aside for today. Atlas will return it '||to_char(v_existing.returns_on,'Mon FMDD')||'.'
        when v_existing.returns_on=v_existing.service_date+1 then 'Set aside for today. It will return tomorrow.'
        else 'Set aside for today. It will return '||to_char(v_existing.returns_on,'Mon FMDD')||'.'
      end,
      'deduplicated',true
    );
  end if;

  select * into v_task
  from atlas.tasks
  where id = p_task_id
  for update;

  if v_task.id is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  if v_task.status not in ('open','blocked') then
    raise exception 'Only open work can be set aside for today.' using errcode = '22023';
  end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);

  if not atlas.is_farm_owner(v_task.farm_id)
     and not (
       v_role in ('farm_hand','manager')
       and v_membership_id is not null
       and v_task.visibility_scope = 'assigned_worker'
       and v_task.assigned_membership_id = v_membership_id
     )
  then
    raise exception 'This task is not assigned to the signed-in farm member.' using errcode = '42501';
  end if;

  v_safe_boundary := atlas.task_safe_boundary_date_v1(v_task.id);
  select rs.state into v_clock_state
  from atlas.rhythm_state rs
  where rs.current_task_id = v_task.id
  order by case rs.state
    when 'fallen_out_of_rhythm' then 0
    when 'due' then 1
    when 'coming_due' then 2
    else 3
  end, rs.updated_at desc
  limit 1;

  v_overdue_days := greatest(0, coalesce(v_local_date - v_task.due_date, 0));
  select count(*) + 1 into v_deferral_number
  from atlas.task_day_dispositions d
  where d.task_id = v_task.id
    and d.disposition = 'set_aside';

  v_consequence := case
    when v_clock_state = 'fallen_out_of_rhythm'
      or (v_safe_boundary is not null and v_local_date >= v_safe_boundary) then 'at_risk'
    when v_task.due_date is not null and v_task.due_date < v_local_date then 'overdue'
    when v_task.due_date is not null and v_task.due_date = v_local_date then 'due'
    else 'not_due'
  end;

  v_returns_on := case
    when v_consequence in ('overdue','at_risk') then v_local_date + 1
    when v_safe_boundary is not null then greatest(v_local_date + 1, least(v_requested_return, v_safe_boundary))
    else v_requested_return
  end;
  v_request_honored := v_returns_on = v_requested_return;

  insert into atlas.task_day_dispositions (
    farm_id,task_id,actor_user_id,actor_membership_id,service_date,disposition,
    due_date_snapshot,safe_boundary_date,clock_state_snapshot,consequence,
    overdue_days,deferral_number,returns_on,requested_return_date,idempotency_key,metadata
  ) values (
    v_task.farm_id,v_task.id,auth.uid(),v_membership_id,v_local_date,'set_aside',
    v_task.due_date,v_safe_boundary,v_clock_state,v_consequence,
    v_overdue_days,v_deferral_number,v_returns_on,v_requested_return,p_idempotency_key,
    jsonb_build_object(
      'task_status_unchanged',true,
      'due_date_unchanged',true,
      'clock_state_unchanged',true,
      'physical_state_unchanged',true,
      'requested_return_date',v_requested_return,
      'actual_return_date',v_returns_on,
      'request_honored',v_request_honored,
      'source','task_set_aside_today_v2'
    )
  )
  on conflict (task_id,service_date,disposition) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from atlas.task_day_dispositions
    where task_id = v_task.id
      and service_date = v_local_date
      and disposition = 'set_aside';
    v_requested_return := coalesce(v_row.requested_return_date,v_row.returns_on);
    v_returns_on := v_row.returns_on;
    v_request_honored := v_requested_return=v_returns_on;
    v_consequence := v_row.consequence;
    v_overdue_days := v_row.overdue_days;
    v_deferral_number := v_row.deferral_number;
    v_safe_boundary := v_row.safe_boundary_date;
    v_clock_state := v_row.clock_state_snapshot;
  end if;

  v_event_id := atlas.emit_workflow_event_v1(
    v_task.farm_id,
    'task',
    v_task.id,
    coalesce(nullif(v_task.task_series_key,''),v_task.id::text),
    'task_set_aside_today',
    v_local_date,
    'task-set-aside:' || v_task.id::text || ':' || v_local_date::text,
    jsonb_build_object(
      'task_title',v_task.title,
      'task_day_disposition_id',v_row.id,
      'service_date',v_local_date,
      'due_date',v_task.due_date,
      'safe_boundary_date',v_safe_boundary,
      'clock_state',v_clock_state,
      'consequence',v_consequence,
      'overdue_days',v_overdue_days,
      'deferral_count',v_deferral_number,
      'requested_return_date',v_requested_return,
      'returns_on',v_returns_on,
      'request_honored',v_request_honored,
      'actor_user_id',auth.uid(),
      'actor_membership_id',v_membership_id,
      'task_status_unchanged',true,
      'due_date_unchanged',true
    )
  );

  v_message := case
    when v_consequence='at_risk' then 'Set aside for today. This work is at risk and returns tomorrow.'
    when v_consequence='overdue' then 'Set aside for today. This work remains overdue and returns tomorrow.'
    when not v_request_honored and v_safe_boundary is not null
      then 'Set aside for today. Atlas will return it '||to_char(v_returns_on,'Mon FMDD')||' because the farm window closes then.'
    when v_returns_on=v_local_date+1 then 'Set aside for today. It will return tomorrow.'
    else 'Set aside for today. It will return '||to_char(v_returns_on,'Mon FMDD')||'.'
  end;

  return jsonb_build_object(
    'contractVersion','task_set_aside_today_v2',
    'dispositionId',v_row.id,
    'workflowEventId',v_event_id,
    'taskId',v_task.id,
    'serviceDate',v_local_date,
    'dueDate',v_task.due_date,
    'safeBoundaryDate',v_safe_boundary,
    'requestedReturnDate',v_requested_return,
    'clockState',v_clock_state,
    'consequence',v_consequence,
    'overdueDays',v_overdue_days,
    'deferralCount',v_deferral_number,
    'returnsOn',v_returns_on,
    'requestHonored',v_request_honored,
    'message',v_message,
    'taskStatusUnchanged',true,
    'dueDateUnchanged',true,
    'deduplicated',false
  );
end;
$$;

create or replace function atlas.viewer_task_day_dispositions_v1(
  p_day date default timezone('America/Chicago', now())::date
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  with active as (
    select distinct on (d.task_id) d.*
    from atlas.task_day_dispositions d
    where d.service_date <= coalesce(p_day, timezone('America/Chicago', now())::date)
      and d.returns_on > coalesce(p_day, timezone('America/Chicago', now())::date)
      and d.disposition = 'set_aside'
    order by d.task_id,d.service_date desc,d.created_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,
    'taskId',d.task_id,
    'serviceDate',d.service_date,
    'dueDate',d.due_date_snapshot,
    'safeBoundaryDate',d.safe_boundary_date,
    'requestedReturnDate',coalesce(d.requested_return_date,d.returns_on),
    'consequence',d.consequence,
    'overdueDays',d.overdue_days,
    'deferralCount',d.deferral_number,
    'returnsOn',d.returns_on,
    'createdAt',d.created_at,
    'taskTitle',t.title
  ) order by d.created_at), '[]'::jsonb)
  from active d
  join atlas.tasks t on t.id = d.task_id
  where t.status in ('open','blocked')
    and (
      atlas.is_farm_owner(d.farm_id)
      or (
        atlas.current_farm_role(d.farm_id) in ('farm_hand','manager')
        and t.visibility_scope = 'assigned_worker'
        and t.assigned_membership_id = atlas.current_membership_id(d.farm_id)
      )
    );
$$;

revoke all on function atlas.set_task_aside_today_v2(uuid,date,text) from public,anon,authenticated;
revoke all on function atlas.viewer_task_day_dispositions_v1(date) from public,anon,authenticated;
grant execute on function atlas.set_task_aside_today_v2(uuid,date,text) to authenticated,service_role;
grant execute on function atlas.viewer_task_day_dispositions_v1(date) to authenticated,service_role;
