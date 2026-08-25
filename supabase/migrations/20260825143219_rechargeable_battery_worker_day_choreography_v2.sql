update atlas.resources r
set metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object(
  'worker_day_session_contract','rechargeable_resource_day_v2',
  'worker_day_session_capacity',2,
  'recharge_required_between_sessions',true,
  'recharge_day_window','afternoon'
),updated_at=now()
where r.stable_key='battery_push_mower_battery_set';

create or replace function atlas.ensure_worker_day_battery_recharge_v1(p_farm_id uuid,p_membership_id uuid,p_service_date date)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_member atlas.farm_memberships%rowtype;
  v_task atlas.tasks%rowtype;
  v_occurrence uuid;
  v_materialized jsonb;
  v_task_id uuid;
begin
  select * into v_member from atlas.farm_memberships where id=p_membership_id and farm_id=p_farm_id and active;
  if v_member.id is null then raise exception 'Active worker membership required.' using errcode='42501'; end if;

  select * into v_task
  from atlas.tasks t
  where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id and t.due_date=p_service_date
    and t.status in ('open','blocked')
    and (t.metadata->>'restores_resource_key'='battery_push_mower_battery_set'
      or (t.title='Charge DeWalt Batteries for Mowing' and t.task_type='mowing_preparation'))
  order by t.created_at limit 1;

  if v_task.id is not null then
    update atlas.tasks set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'restores_resource_key','battery_push_mower_battery_set','resource_recharge_contract','rechargeable_resource_day_v2',
      'work_order_anchor','afternoon','day_window','afternoon','display_action','Charge','display_subject','DeWalt batteries for mowing'
    ),updated_at=now() where id=v_task.id;
    update atlas.worker_day_task_placements set day_window='afternoon',sort_order=50,planned_start_at=null,updated_at=now()
      where task_id=v_task.id and membership_id=p_membership_id and service_date=p_service_date and state='placed';
    return jsonb_build_object('state','kept_current','taskId',v_task.id,'dueDate',p_service_date);
  end if;

  v_occurrence:=atlas.plan_fixed_assigned_worker_occurrence_v1(
    p_farm_id=>p_farm_id,p_membership_id=>v_member.id,p_user_id=>v_member.user_id,
    p_definition_key=>'battery_push_mower_recharge_v1',p_policy_key=>'battery_push_mower_recharge_v1:release',
    p_occurrence_key=>'resource-recharge:battery_push_mower_battery_set:'||p_service_date::text,
    p_title=>'Charge DeWalt Batteries for Mowing',p_task_type=>'mowing_preparation',p_due_date=>p_service_date,
    p_priority=>'high',p_action_key=>'prepare',p_series_key=>'battery_push_mower_recharge',p_effort_units=>0.25,
    p_metadata=>jsonb_build_object(
      'task_style','resource_recharge','display_action','Charge','display_subject','DeWalt batteries for mowing',
      'display_location','Battery charging station','collection_zone','Mowing preparation','collection_label','Mowing preparation',
      'work_route','prepare','work_order_anchor','afternoon','day_window','afternoon','quick_complete_allowed',true,
      'restores_resource_key','battery_push_mower_battery_set','resource_recharge_contract','rechargeable_resource_day_v2',
      'completion_independent_schedule',true
    )
  );

  if p_service_date<=(now() at time zone 'America/Chicago')::date then
    v_materialized:=atlas.materialize_specific_work_occurrence_v1(v_occurrence,(now() at time zone 'America/Chicago')::date);
    begin v_task_id:=nullif(v_materialized->>'taskId','')::uuid; exception when others then v_task_id:=null; end;
  end if;
  return jsonb_build_object('state',case when v_task_id is null then 'planned' else 'released' end,'taskId',v_task_id,'occurrenceId',v_occurrence,'dueDate',p_service_date);
end;
$function$;

create or replace function atlas.reconcile_worker_day_battery_sessions_v1(p_farm_id uuid,p_membership_id uuid,p_service_date date)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_task record;
  v_rank integer:=0;
  v_next date;
  v_recharge jsonb;
  v_moved_in integer:=0;
  v_moved_out integer:=0;
  v_count integer:=0;
  v_day date:=p_service_date;
  v_iterations integer:=0;
begin
  if p_farm_id is null or p_membership_id is null or p_service_date is null then raise exception 'Farm, membership, and service date are required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':'||p_membership_id::text||':battery-session-reconcile',0));

  for v_task in
    select t.* from atlas.tasks t
    where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id and t.status='open'
      and t.due_date<p_service_date and (
        t.metadata->>'battery_resource_key'='battery_push_mower_battery_set'
        or coalesce(t.metadata->'required_resource_keys','[]'::jsonb)?'battery_push_mower_battery_set'
      )
    order by t.due_date,t.created_at,t.id for update
  loop
    perform atlas.record_task_transition_v1_internal(
      v_task.id,'rescheduled',left('battery-roll-forward:'||v_task.id::text||':'||p_service_date::text,160),
      p_service_date,null,'Unfinished battery mowing takes the next available battery session.',v_task.action_key,'resource_session_reconcile',
      jsonb_build_object('batterySessionReconcile',true,'fromDate',v_task.due_date,'targetDate',p_service_date,'resourceKey','battery_push_mower_battery_set'),null
    );
    update atlas.tasks set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('battery_priority_date',v_task.due_date,'battery_roll_forward_at',now()),updated_at=now() where id=v_task.id;
    if v_task.planned_occurrence_id is not null then
      update atlas.planned_work_occurrences set planned_due_date=p_service_date,task_payload=jsonb_set(coalesce(task_payload,'{}'::jsonb),'{due_date}',to_jsonb(p_service_date),true),updated_at=now()
      where id=v_task.planned_occurrence_id and state not in ('completed','cancelled');
    end if;
    update atlas.worker_day_task_placements set service_date=p_service_date,planned_start_at=null,updated_at=now() where task_id=v_task.id and state='placed' and service_date<p_service_date;
    v_moved_in:=v_moved_in+1;
  end loop;

  loop
    v_iterations:=v_iterations+1;
    exit when v_iterations>14;
    select count(*)::integer into v_count from atlas.tasks t
    where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id and t.status='open' and t.due_date=v_day and (
      t.metadata->>'battery_resource_key'='battery_push_mower_battery_set' or coalesce(t.metadata->'required_resource_keys','[]'::jsonb)?'battery_push_mower_battery_set');
    exit when v_count<=2;

    select t.* into v_task from atlas.tasks t
    where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id and t.status='open' and t.due_date=v_day and (
      t.metadata->>'battery_resource_key'='battery_push_mower_battery_set' or coalesce(t.metadata->'required_resource_keys','[]'::jsonb)?'battery_push_mower_battery_set')
    order by coalesce(nullif(t.metadata->>'battery_priority_date','')::date,t.due_date) desc,t.created_at desc,t.id desc limit 1 for update;
    v_next:=atlas.worker_day_on_or_after_v1(p_farm_id,p_membership_id,v_day+1);
    exit when v_next is null;
    perform atlas.record_task_transition_v1_internal(v_task.id,'rescheduled',left('battery-capacity-push:'||v_task.id::text||':'||v_next::text,160),v_next,null,
      'A charged battery set supports two mowing sessions only when a recharge fits between them; newer mowing moves to the next worker day.',v_task.action_key,'resource_session_reconcile',
      jsonb_build_object('batterySessionReconcile',true,'fromDate',v_day,'targetDate',v_next,'resourceKey','battery_push_mower_battery_set','maxSessionsWithRecharge',2),null);
    update atlas.tasks set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('battery_capacity_shifted_at',now(),'battery_capacity_shifted_from',v_day,'battery_capacity_shifted_to',v_next),updated_at=now() where id=v_task.id;
    if v_task.planned_occurrence_id is not null then update atlas.planned_work_occurrences set planned_due_date=v_next,task_payload=jsonb_set(coalesce(task_payload,'{}'::jsonb),'{due_date}',to_jsonb(v_next),true),updated_at=now() where id=v_task.planned_occurrence_id and state not in ('completed','cancelled'); end if;
    update atlas.worker_day_task_placements set service_date=v_next,planned_start_at=null,updated_at=now() where task_id=v_task.id and state='placed' and service_date=v_day;
    v_moved_out:=v_moved_out+1;
  end loop;

  select count(*)::integer into v_count from atlas.tasks t
  where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id and t.status='open' and t.due_date=p_service_date and (
    t.metadata->>'battery_resource_key'='battery_push_mower_battery_set' or coalesce(t.metadata->'required_resource_keys','[]'::jsonb)?'battery_push_mower_battery_set');

  v_rank:=0;
  for v_task in
    select t.* from atlas.tasks t
    where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id and t.status='open' and t.due_date=p_service_date and (
      t.metadata->>'battery_resource_key'='battery_push_mower_battery_set' or coalesce(t.metadata->'required_resource_keys','[]'::jsonb)?'battery_push_mower_battery_set')
    order by coalesce(nullif(t.metadata->>'battery_priority_date','')::date,t.due_date),t.created_at,t.id for update
  loop
    v_rank:=v_rank+1;
    update atlas.tasks set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'resource_recharge_contract','rechargeable_resource_day_v2','battery_session_slot',v_rank,
      'work_order_anchor',case when v_rank=1 then 'morning' else 'evening' end,
      'day_window',case when v_rank=1 then 'morning' else 'evening' end
    ),updated_at=now() where id=v_task.id;
    update atlas.worker_day_task_placements set day_window=case when v_rank=1 then 'morning' else 'evening' end,
      sort_order=case when v_rank=1 then 20 else 80 end,planned_start_at=null,updated_at=now()
    where task_id=v_task.id and membership_id=p_membership_id and service_date=p_service_date and state='placed';
  end loop;

  if v_count=2 then v_recharge:=atlas.ensure_worker_day_battery_recharge_v1(p_farm_id,p_membership_id,p_service_date); end if;
  return jsonb_build_object('contractVersion','rechargeable_resource_day_v2','serviceDate',p_service_date,'sessionCount',v_count,'movedIn',v_moved_in,'movedOut',v_moved_out,'recharge',v_recharge,
    'truthBoundary',jsonb_build_object('oneChargeOneMowingSession',true,'secondSessionRequiresRecharge',true,'firstSessionWindow','morning','rechargeWindow','afternoon','secondSessionWindow','evening','thirdSessionForbidden',true,'overdueWorkPushesNewerWork',true));
end;
$function$;

create or replace function atlas.worker_day_resource_session_availability_v1(p_task_id uuid,p_membership_id uuid,p_service_date date)
returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare v_claim record; v_existing_group_count integer:=0; v_same_group_present boolean:=false; v_existing_groups jsonb:='[]'::jsonb; v_claims jsonb:='[]'::jsonb; v_conflicts jsonb:='[]'::jsonb; v_allowed boolean:=true; v_recharge_present boolean:=false;
begin
if p_task_id is null or p_membership_id is null or p_service_date is null then return jsonb_build_object('contractVersion','worker_day_resource_session_availability_v2','allowed',false,'reason','task_membership_and_service_date_required','claims','[]'::jsonb,'conflicts','[]'::jsonb); end if;
for v_claim in select * from atlas.worker_day_resource_session_claims_v1(p_task_id) loop
  select count(distinct existing_claim.session_group_key)::integer,coalesce(bool_or(existing_claim.session_group_key=v_claim.session_group_key),false),coalesce(jsonb_agg(distinct jsonb_build_object('taskId',placement.task_id,'sessionGroupKey',existing_claim.session_group_key)),'[]'::jsonb)
  into v_existing_group_count,v_same_group_present,v_existing_groups
  from atlas.worker_day_task_placements placement cross join lateral atlas.worker_day_resource_session_claims_v1(placement.task_id) existing_claim
  where placement.membership_id=p_membership_id and placement.service_date=p_service_date and placement.state='placed' and placement.task_id<>p_task_id and existing_claim.resource_id=v_claim.resource_id;
  select exists(select 1 from atlas.tasks t where t.assigned_membership_id=p_membership_id and t.due_date=p_service_date and t.status in ('open','blocked','done') and t.metadata->>'restores_resource_key'=v_claim.resource_key) into v_recharge_present;
  v_claims:=v_claims||jsonb_build_array(jsonb_build_object('resourceId',v_claim.resource_id,'resourceKey',v_claim.resource_key,'resourceLabel',v_claim.resource_label,'sessionGroupKey',v_claim.session_group_key,'sessionCapacity',v_claim.session_capacity,'existingSessionGroupCount',v_existing_group_count,'sameSessionGroupPresent',v_same_group_present,'rechargePresent',v_recharge_present));
  if not v_same_group_present and (v_existing_group_count>=v_claim.session_capacity or (v_existing_group_count>=1 and not v_recharge_present)) then
    v_allowed:=false; v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('resourceId',v_claim.resource_id,'resourceKey',v_claim.resource_key,'resourceLabel',v_claim.resource_label,'sessionCapacity',v_claim.session_capacity,'existingSessions',v_existing_groups,'rechargeRequired',v_existing_group_count>=1,'rechargePresent',v_recharge_present));
  end if;
end loop;
return jsonb_build_object('contractVersion','worker_day_resource_session_availability_v2','taskId',p_task_id,'membershipId',p_membership_id,'serviceDate',p_service_date,'allowed',v_allowed,'claims',v_claims,'conflicts',v_conflicts,'truthBoundary',jsonb_build_object('resourceSessionCapacityIsSchedulingCapacity',true,'secondSessionRequiresRecharge',true,'differentSessionGroupsConsumeSeparateCapacity',true,'resourceReadinessRemainsSeparateFromSessionCapacity',true));
end;$function$;

revoke all on function atlas.ensure_worker_day_battery_recharge_v1(uuid,uuid,date) from public,anon,authenticated;
revoke all on function atlas.reconcile_worker_day_battery_sessions_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.ensure_worker_day_battery_recharge_v1(uuid,uuid,date) to service_role;
grant execute on function atlas.reconcile_worker_day_battery_sessions_v1(uuid,uuid,date) to service_role;

insert into atlas.authenticated_rpc_registry(signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,registered_at,reviewed_at,anonymous_execute_expected)
values
('atlas.ensure_worker_day_battery_recharge_v1(uuid, uuid, date)','service_internal','verified','active',false,true,true,0,0,jsonb_build_object('purpose','Ensure the explicit recharge move between two battery mower sessions.','directSignedInEndpoint',false),now(),now(),false),
('atlas.reconcile_worker_day_battery_sessions_v1(uuid, uuid, date)','service_internal','verified','active',false,true,true,0,0,jsonb_build_object('purpose','Carry overdue battery mowing forward, cap a worker day at two sessions, place recharge between them, and push newer work.','directSignedInEndpoint',false),now(),now(),false)
on conflict(signature) do update set classification=excluded.classification,confidence=excluded.confidence,review_status=excluded.review_status,authenticated_execute_expected=excluded.authenticated_execute_expected,security_definer_expected=excluded.security_definer_expected,service_execute_expected=excluded.service_execute_expected,caller_count=excluded.caller_count,policy_reference_count=excluded.policy_reference_count,evidence=excluded.evidence,reviewed_at=now(),anonymous_execute_expected=excluded.anonymous_execute_expected;

select atlas.reconcile_worker_day_battery_sessions_v1('6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid,'23e98e5e-16ca-40d8-872c-c77e06baa167'::uuid,date '2026-08-25');