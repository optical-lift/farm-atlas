begin;

create or replace function atlas.manual_task_context_v1(
  p_object_key text,
  p_assigned_membership_id uuid default null,
  p_due_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_object atlas.growing_objects%rowtype;
  v_role text;
  v_viewer_membership_id uuid;
  v_day_load jsonb;
begin
  select * into v_object
  from atlas.growing_objects
  where stable_key = p_object_key
  limit 1;

  if v_object.id is null then
    raise exception 'Farm object not found.' using errcode='P0002';
  end if;

  v_role := atlas.current_farm_role(v_object.farm_id);
  if auth.uid() is null or v_role is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select id into v_viewer_membership_id
  from atlas.farm_memberships
  where farm_id=v_object.farm_id and user_id=auth.uid() and active=true
  order by created_at
  limit 1;

  if p_assigned_membership_id is not null and p_due_date is not null then
    v_day_load := atlas.member_day_load_core_v1(v_object.farm_id,p_assigned_membership_id,p_due_date,null);
  end if;

  return jsonb_build_object(
    'farmId',v_object.farm_id,
    'object',jsonb_build_object('id',v_object.id,'key',v_object.stable_key,'label',v_object.label,'zoneId',v_object.zone_id),
    'canAuthor',v_role in ('owner','manager'),
    'viewerMembershipId',v_viewer_membership_id,
    'memberships',coalesce((
      select jsonb_agg(jsonb_build_object(
        'membershipId',m.id,
        'userId',m.user_id,
        'role',m.role,
        'workerKey',m.worker_key,
        'displayName',coalesce(p.display_name,m.worker_key,initcap(m.role)),
        'activeTaskCount',(select count(*) from atlas.tasks t where t.assigned_membership_id=m.id and t.status in ('open','blocked'))
      ) order by coalesce(p.display_name,m.worker_key,initcap(m.role)))
      from atlas.farm_memberships m
      left join atlas.user_profiles p on p.user_id=m.user_id
      where m.farm_id=v_object.farm_id and m.active=true
    ),'[]'::jsonb),
    'dayLoad',v_day_load
  );
end;
$function$;

create or replace function atlas.create_manual_task_v1(
  p_object_key text,
  p_action_kind text,
  p_title text,
  p_current_truth text,
  p_after_truth text,
  p_unlock_text text,
  p_effort_class text,
  p_assigned_membership_id uuid,
  p_due_date date,
  p_work_window_key text,
  p_date_commitment text,
  p_bring_into_work_now boolean,
  p_crop_cycle_ids uuid[],
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_object atlas.growing_objects%rowtype;
  v_farm atlas.farms%rowtype;
  v_assignee atlas.farm_memberships%rowtype;
  v_task_id uuid;
  v_effort numeric;
  v_release_time time;
  v_existing uuid;
  v_today date;
begin
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'Title is required.' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_current_truth,'')),'') is null or length(btrim(p_current_truth)) > 600 then raise exception 'Current truth is required and must be 600 characters or fewer.' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_after_truth,'')),'') is null or length(btrim(p_after_truth)) > 600 then raise exception 'Truth after completion is required and must be 600 characters or fewer.' using errcode='22023'; end if;
  if btrim(p_current_truth)=btrim(p_after_truth) then raise exception 'Current truth and truth after completion must describe a real change.' using errcode='22023'; end if;
  if p_date_commitment not in ('hard_date','floating') then raise exception 'Choose a valid date commitment.' using errcode='22023'; end if;

  select * into v_object from atlas.growing_objects where stable_key=p_object_key limit 1;
  if v_object.id is null then raise exception 'Farm object not found.' using errcode='P0002'; end if;
  if auth.uid() is null or atlas.current_farm_role(v_object.farm_id) not in ('owner','manager') then raise exception 'Owner or manager access required.' using errcode='42501'; end if;

  select * into v_farm from atlas.farms where id=v_object.farm_id;
  select * into v_assignee from atlas.farm_memberships where id=p_assigned_membership_id and farm_id=v_object.farm_id and active=true;
  if v_assignee.id is null then raise exception 'Choose an active farm member.' using errcode='22023'; end if;

  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is not null then
    select id into v_existing from atlas.tasks
    where farm_id=v_object.farm_id and metadata->>'manual_task_idempotency_key'=p_idempotency_key
    order by created_at desc limit 1;
    if v_existing is not null then return jsonb_build_object('taskId',v_existing,'deduplicated',true); end if;
  end if;

  v_effort := case p_effort_class when 'light' then 0.5 when 'heavy' then 2 else 1 end;
  v_release_time := case p_work_window_key when 'first_thing' then time '06:30' when 'midday' then time '11:30' when 'afternoon' then time '14:00' when 'evening' then time '17:00' else time '08:00' end;
  v_today := (now() at time zone 'America/Chicago')::date;

  insert into atlas.tasks(
    farm_id,zone_id,title,task_type,status,priority,due_date,unlock_text,metadata,
    action_key,work_class,visibility_scope,assigned_membership_id,released_at,release_reason,
    organization_id,task_scope,assigned_user_id,created_by_user_id,origin_kind,work_lane,
    commitment_kind,effort_units
  ) values (
    v_object.farm_id,v_object.zone_id,btrim(p_title),coalesce(nullif(btrim(p_action_kind),''),'general'),'open','normal',p_due_date,
    nullif(btrim(coalesce(p_unlock_text,'')),''),
    jsonb_build_object(
      'manual_task',true,'manual_task_contract','manual_task_authoring_v1',
      'manual_task_idempotency_key',nullif(btrim(coalesce(p_idempotency_key,'')),''),
      'display_action',coalesce(nullif(btrim(p_action_kind),''),'work'),'display_subject',btrim(p_title),
      'execution_place',v_object.label,'current_truth',btrim(p_current_truth),'after_truth',btrim(p_after_truth),
      'execution_done_when',btrim(p_after_truth),
      'state_transition',jsonb_build_object('contractVersion','task_move_state_change_v1','currentTruth',btrim(p_current_truth),'afterTruth',btrim(p_after_truth),'objectId',v_object.id),
      'work_window_key',coalesce(nullif(btrim(p_work_window_key),''),'morning'),
      'bring_into_work_now',coalesce(p_bring_into_work_now,false),
      'effort_class',coalesce(nullif(btrim(p_effort_class),''),'standard')
    ),
    coalesce(nullif(btrim(p_action_kind),''),'general'),coalesce(nullif(btrim(p_effort_class),''),'standard'),'assigned_worker',v_assignee.id,now(),'manual_task_authoring_v1',
    v_farm.organization_id,'farm_operation',v_assignee.user_id,auth.uid(),'owner_assigned',case when p_date_commitment='hard_date' then 'required' else 'discretionary' end,p_date_commitment,v_effort
  ) returning id into v_task_id;

  insert into atlas.task_objects(task_id,object_id,role) values(v_task_id,v_object.id,'target') on conflict do nothing;
  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  select v_task_id,c.id,'affects','confirmed','manual_task_authoring',jsonb_build_object('object_id',v_object.id)
  from atlas.crop_cycles c where c.id=any(coalesce(p_crop_cycle_ids,array[]::uuid[])) and c.farm_id=v_object.farm_id
  on conflict do nothing;

  insert into atlas.object_state(object_id,farm_id,operational_truth,operational_truth_source,operational_truth_task_id,operational_truth_changed_at,last_touched_at,metadata)
  values(v_object.id,v_object.farm_id,btrim(p_current_truth),'manual_task_current',v_task_id,now(),v_today,jsonb_build_object('operationalTruthContract','task_move_state_change_v1','operationalTruthPhase','current'))
  on conflict(object_id) do update set operational_truth=excluded.operational_truth,operational_truth_source=excluded.operational_truth_source,operational_truth_task_id=excluded.operational_truth_task_id,operational_truth_changed_at=excluded.operational_truth_changed_at,last_touched_at=excluded.last_touched_at,metadata=coalesce(atlas.object_state.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now();

  insert into atlas.object_activity_events(farm_id,object_id,event_type,event_date,note,created_by,source,idempotency_key,metadata)
  values(v_object.farm_id,v_object.id,'task_state_declared',v_today,btrim(p_current_truth),'atlas','manual_task_authoring','manual-task-current:'||v_task_id::text,jsonb_build_object('task_id',v_task_id,'current_truth',btrim(p_current_truth),'after_truth',btrim(p_after_truth)))
  on conflict(farm_id,idempotency_key) where idempotency_key is not null do nothing;

  insert into atlas.task_notification_plans(farm_id,task_id,release_local_time,close_local_time,nudge_after_minutes,group_key,group_label,source,active,metadata)
  values(v_object.farm_id,v_task_id,v_release_time,null,60,'manual-task:'||v_object.stable_key,initcap(coalesce(nullif(btrim(p_action_kind),''),'work')),'manual_task_authoring',true,jsonb_build_object('object_id',v_object.id,'work_window_key',p_work_window_key,'commitment_kind',p_date_commitment))
  on conflict(task_id) do update set release_local_time=excluded.release_local_time,group_key=excluded.group_key,group_label=excluded.group_label,source=excluded.source,active=true,metadata=excluded.metadata,updated_at=now();

  return jsonb_build_object(
    'taskId',v_task_id,'deduplicated',false,
    'task',jsonb_build_object('id',v_task_id,'title',btrim(p_title),'dueDate',p_due_date,'commitmentKind',p_date_commitment),
    'object',jsonb_build_object('id',v_object.id,'key',v_object.stable_key,'label',v_object.label),
    'assignee',jsonb_build_object('membershipId',v_assignee.id,'displayName',coalesce((select display_name from atlas.user_profiles where user_id=v_assignee.user_id),v_assignee.worker_key,initcap(v_assignee.role))),
    'dayLoad',atlas.member_day_load_core_v1(v_object.farm_id,v_assignee.id,p_due_date,null)
  );
end;
$function$;

revoke all on function atlas.manual_task_context_v1(text,uuid,date) from public,anon;
revoke all on function atlas.create_manual_task_v1(text,text,text,text,text,text,text,uuid,date,text,text,boolean,uuid[],text) from public,anon;
grant execute on function atlas.manual_task_context_v1(text,uuid,date) to authenticated,service_role;
grant execute on function atlas.create_manual_task_v1(text,text,text,text,text,text,text,uuid,date,text,text,boolean,uuid[],text) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,registered_at,reviewed_at)
values
('atlas.manual_task_context_v1(text, uuid, date)','app_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('source','manual_task_authoring_v1','authorization','active same-farm membership'),now(),now()),
('atlas.create_manual_task_v1(text, text, text, text, text, text, text, uuid, date, text, text, boolean, uuid[], text)','owner_admin_endpoint','verified','active',true,true,true,1,0,jsonb_build_object('source','manual_task_authoring_v1','authorization','owner or manager'),now(),now())
on conflict(signature) do update set classification=excluded.classification,confidence=excluded.confidence,review_status=excluded.review_status,authenticated_execute_expected=excluded.authenticated_execute_expected,security_definer_expected=excluded.security_definer_expected,service_execute_expected=excluded.service_execute_expected,caller_count=excluded.caller_count,evidence=excluded.evidence,reviewed_at=excluded.reviewed_at;

commit;
