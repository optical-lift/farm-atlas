-- Adopt current mowing work, preserve exact completed-mow baselines, and disable legacy date recreation.

do $$
declare
  v_farm atlas.farms%rowtype;
  v_org uuid;
  v_anna atlas.farm_memberships%rowtype;
  v_owner atlas.farm_memberships%rowtype;
  v_route record;
  v_state atlas.rhythm_state%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_task_id uuid;
  v_occurrence_id uuid;
  v_task_due date;
  v_task_updated timestamptz;
  v_done_id uuid;
  v_done_at timestamptz;
  v_satisfaction_id uuid;
  v_workflow_event_id uuid;
  v_override_at timestamptz;
  v_override_seconds integer;
  v_result jsonb;
  v_now timestamptz:=now();
begin
  select * into v_farm from atlas.farms where stable_key='elm_farm';
  v_org:=v_farm.organization_id;
  select * into v_anna from atlas.farm_memberships where farm_id=v_farm.id and worker_key='anna' and active order by created_at limit 1;
  select * into v_owner from atlas.farm_memberships where farm_id=v_farm.id and role='owner' and active order by created_at limit 1;

  for v_route in
    select go.id as object_id,go.stable_key as object_key,go.label,go.zone_id,go.metadata,
      go.metadata->>'legacy_collection_member_key' as legacy_member_key,
      rs.id as state_id,rs.rhythm_binding_id,rs.rhythm_rule_id
    from atlas.growing_objects go
    join atlas.rhythm_state rs on rs.subject_id=go.id and rs.rhythm_key='mowing' and rs.subject_kind='growing_object'
    where go.farm_id=v_farm.id and go.object_mode='mowing_route'
    order by go.sort_order
  loop
    v_task_id:=null;v_occurrence_id:=null;v_task_due:=null;v_task_updated:=null;
    v_done_id:=null;v_done_at:=null;v_satisfaction_id:=null;v_workflow_event_id:=null;
    select * into v_state from atlas.rhythm_state where id=v_route.state_id for update;
    select * into v_rule from atlas.rhythm_rules where id=v_state.rhythm_rule_id;

    select t.id,t.planned_occurrence_id,t.due_date,t.updated_at
      into v_task_id,v_occurrence_id,v_task_due,v_task_updated
    from atlas.tasks t
    where t.farm_id=v_farm.id and t.status in ('open','blocked') and t.task_type='mowing'
      and coalesce(nullif(t.metadata->>'canonical_collection_member_key',''),nullif(t.metadata->>'collection_member_key',''))=v_route.legacy_member_key
    order by t.due_date nulls last,t.created_at limit 1;

    if v_task_id is not null then
      update atlas.tasks set
        title='Mowing — '||v_route.label,action_key='mow',work_class='standard',
        visibility_scope='assigned_worker',assigned_membership_id=v_anna.id,
        metadata=(coalesce(metadata,'{}'::jsonb)
          - 'recreate_after_days' - 'recreate_weekday' - 'repeat_after_days' - 'repeat_anchor_day'
          - 'weather_delay_reason' - 'weather_delayed_at' - 'weather_delayed_by' - 'germination_variety_key')
          || jsonb_build_object(
            'rhythm_state_id',v_state.id,'rhythm_binding_id',v_state.rhythm_binding_id,
            'rhythm_rule_id',v_state.rhythm_rule_id,'rhythm_key','mowing',
            'task_style','mowing_round','structured_result_required',true,'clock_managed',true,
            'mowing_route_object_id',v_route.object_id,'mowing_route_key',v_route.object_key,
            'display_action','Mow','display_subject',v_route.label,
            'display_detail',(v_route.metadata->>'equipment_group')||' · target '||(v_route.metadata->>'target_cut_height_inches')||' in',
            'collection_zone',v_route.metadata->>'zone_label','work_collection_key','mowing','work_collection_role','member',
            'collection_member_key',v_route.object_key,'canonical_collection_member_key',v_route.object_key,
            'legacy_collection_member_key',v_route.legacy_member_key,'work_rhythm','Mowing',
            'equipment_group',v_route.metadata->>'equipment_group',
            'target_cut_height_inches',v_route.metadata->>'target_cut_height_inches',
            'recreate_on_done',false,'time_claims_physical_condition',false
          ),updated_at=now()
      where id=v_task_id;
      insert into atlas.task_objects(task_id,object_id,role)
      values(v_task_id,v_route.object_id,'mowing_route')
      on conflict(task_id,object_id) do update set role=excluded.role;
      update atlas.rhythm_state set current_task_id=v_task_id,current_occurrence_id=v_occurrence_id,updated_at=now() where id=v_state.id;
    end if;

    select t.id,t.completed_at into v_done_id,v_done_at
    from atlas.tasks t
    where t.farm_id=v_farm.id and t.status='done' and t.task_type='mowing' and t.completed_at is not null
      and coalesce(nullif(t.metadata->>'canonical_collection_member_key',''),nullif(t.metadata->>'collection_member_key',''))=v_route.legacy_member_key
    order by t.completed_at desc,t.id desc limit 1;

    if v_done_id is not null then
      insert into atlas.rhythm_satisfactions(
        organization_id,farm_id,rhythm_state_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,
        subject_kind,subject_id,satisfaction_key,satisfaction_kind,satisfied_at,renewal_interval_seconds,
        source_kind,source_id,source_event,source_task_id,source_object_id,policy_match,evidence,created_by_user_id
      ) values(
        v_org,v_farm.id,v_state.id,v_state.rhythm_binding_id,v_state.rhythm_rule_id,'mowing',
        'growing_object',v_route.object_id,'mowing-baseline:'||v_route.object_id::text||':'||v_done_id::text,
        'full',v_done_at,null,'task',v_done_id,'done',v_done_id,v_route.object_id,
        jsonb_build_object('matchKind','append_only_baseline','ruleKey',v_rule.rule_key),
        jsonb_build_object('taskId',v_done_id,'completedAt',v_done_at,'source','legacy_canonical_mowing_task'),v_owner.user_id
      ) on conflict(farm_id,satisfaction_key) do nothing returning id into v_satisfaction_id;
      if v_satisfaction_id is null then
        select id into v_satisfaction_id from atlas.rhythm_satisfactions
        where farm_id=v_farm.id and satisfaction_key='mowing-baseline:'||v_route.object_id::text||':'||v_done_id::text;
      end if;

      insert into atlas.mowing_area_state(
        object_id,organization_id,farm_id,status,last_mowed_at,last_observed_at,
        current_task_id,current_occurrence_id,equipment_group,target_cut_height_inches,metadata
      ) values(
        v_route.object_id,v_org,v_farm.id,'resting',v_done_at,v_done_at,v_task_id,v_occurrence_id,
        v_route.metadata->>'equipment_group',(v_route.metadata->>'target_cut_height_inches')::numeric,
        jsonb_build_object('baselineTaskId',v_done_id,'baselineSource','legacy_canonical_mowing_task')
      ) on conflict(object_id) do update set
        last_mowed_at=greatest(coalesce(atlas.mowing_area_state.last_mowed_at,excluded.last_mowed_at),excluded.last_mowed_at),
        last_observed_at=greatest(coalesce(atlas.mowing_area_state.last_observed_at,excluded.last_observed_at),excluded.last_observed_at),
        current_task_id=excluded.current_task_id,current_occurrence_id=excluded.current_occurrence_id,
        equipment_group=excluded.equipment_group,target_cut_height_inches=excluded.target_cut_height_inches,
        metadata=atlas.mowing_area_state.metadata||excluded.metadata,updated_at=now();

      update atlas.rhythm_state set
        last_qualifying_satisfaction_id=v_satisfaction_id,lease_started_at=v_done_at,
        warning_at=v_done_at+make_interval(secs=>greatest(0,v_rule.validity_interval_seconds-v_rule.warning_window_seconds)),
        due_at=v_done_at+make_interval(secs=>v_rule.validity_interval_seconds),
        failure_at=v_done_at+make_interval(secs=>v_rule.validity_interval_seconds+v_rule.grace_window_seconds),
        updated_at=now()
      where id=v_state.id;
    end if;

    if v_route.object_key='mowing_u_pick_route' and v_task_id is not null and v_task_due is not null then
      v_override_at:=coalesce(v_task_updated,v_now);
      v_override_seconds:=greatest(3600,extract(epoch from (((v_task_due::timestamp+time '08:00') at time zone 'America/Chicago')-v_override_at))::integer);
      insert into atlas.workflow_events(farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload,created_at)
      values(
        v_farm.id,'mowing-owner-delay:'||v_state.id::text||':'||v_task_due::text,'rhythm_state',v_state.id,
        'mowing:growing_object:'||v_route.object_id::text,'game_master_satisfaction',(v_override_at at time zone 'America/Chicago')::date,
        jsonb_build_object('rhythm_state_id',v_state.id,'reason','Existing Owner equipment hold preserved during mowing Clock enrollment.','renewal_interval_seconds',v_override_seconds,'clock_version','rhythm_clock_v1'),v_override_at
      ) on conflict(farm_id,event_key) do update set payload=atlas.workflow_events.payload||excluded.payload
      returning id into v_workflow_event_id;
      insert into atlas.rhythm_satisfactions(
        organization_id,farm_id,rhythm_state_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,subject_kind,subject_id,
        satisfaction_key,satisfaction_kind,satisfied_at,renewal_interval_seconds,source_kind,source_id,source_event,
        source_workflow_event_id,source_object_id,policy_match,evidence,created_by_user_id
      ) values(
        v_org,v_farm.id,v_state.id,v_state.rhythm_binding_id,v_state.rhythm_rule_id,'mowing','growing_object',v_route.object_id,
        'mowing-owner-delay:'||v_state.id::text||':'||v_task_due::text,'game_master',v_override_at,v_override_seconds,
        'owner_action',v_workflow_event_id,'game_master_satisfaction',v_workflow_event_id,v_route.object_id,
        jsonb_build_object('matchKind','owner_governed_override','reason','Existing equipment hold'),
        jsonb_build_object('workflowEventId',v_workflow_event_id,'taskId',v_task_id,'dueDate',v_task_due),v_owner.user_id
      ) on conflict(farm_id,satisfaction_key) do nothing returning id into v_satisfaction_id;
      if v_satisfaction_id is null then
        select id into v_satisfaction_id from atlas.rhythm_satisfactions
        where farm_id=v_farm.id and satisfaction_key='mowing-owner-delay:'||v_state.id::text||':'||v_task_due::text;
      end if;
      update atlas.rhythm_state set
        last_qualifying_satisfaction_id=v_satisfaction_id,lease_started_at=v_override_at,
        warning_at=v_override_at+make_interval(secs=>greatest(0,v_override_seconds-v_rule.warning_window_seconds)),
        due_at=v_override_at+make_interval(secs=>v_override_seconds),
        failure_at=v_override_at+make_interval(secs=>v_override_seconds+v_rule.grace_window_seconds),
        state_reason=jsonb_build_object('source','owner_governed_override','reason','Existing equipment hold','taskId',v_task_id),updated_at=now()
      where id=v_state.id;
    end if;

    update atlas.rhythm_state set
      state=case
        when last_qualifying_satisfaction_id is null then 'uninitialized'
        when v_now<warning_at then 'resting'
        when v_now<due_at then 'coming_due'
        when v_now<failure_at then 'due'
        else 'fallen_out_of_rhythm' end,
      last_evaluated_at=v_now,updated_at=now()
    where id=v_state.id returning * into v_state;

    if v_state.state in ('due','fallen_out_of_rhythm') then
      v_result:=atlas.ensure_rhythm_task_v1(
        v_state.id,v_state.state,
        case when v_state.state='fallen_out_of_rhythm' then v_state.failure_at else v_state.due_at end
      );
    end if;
  end loop;
end;
$$;

insert into atlas.task_objects(task_id,object_id,role)
select t.id,go.id,'mowing_member'
from atlas.tasks t
join atlas.growing_objects route on route.farm_id=t.farm_id and route.stable_key='mowing_u_pick_route'
join atlas.growing_objects go on go.farm_id=t.farm_id and (go.stable_key like 'u_pick_walkway_%' or go.stable_key='u_pick_middle_partition')
where t.status in ('open','blocked') and t.task_type='mowing' and t.metadata->>'mowing_route_key'='mowing_u_pick_route'
on conflict(task_id,object_id) do nothing;
