-- Integrate project review with canonical task decoration, project links, task focus, and Owner Rulebook views.

create or replace function atlas.decorate_biological_clock_task_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_rhythm text := coalesce(new.metadata->>'rhythm_key','');
  v_state_id uuid := atlas.rhythm_safe_uuid_v1(new.metadata->>'rhythm_state_id');
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_zone atlas.zones%rowtype;
  v_project atlas.projects%rowtype;
begin
  if new.generated_from <> 'rhythm_clock' or v_state_id is null then return new; end if;

  if v_rhythm='grow_room_care' then
    new.title := 'Grow Room Care';new.task_type := 'grow_room_care';new.action_key := 'grow_room_round';new.work_class := 'standard';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('manual_top_level_card',true,'round_completion_required',true,'display_action','Care round','display_subject','Grow Room','collection_zone','Grow Room','work_rhythm','Grow Room Care','time_claims_physical_condition',false);
  elsif v_rhythm='guest_readiness' then
    select z.* into v_zone from atlas.rhythm_state rs join atlas.zones z on z.id=rs.subject_id where rs.id=v_state_id and rs.subject_kind='zone';
    new.title := case when lower(coalesce(new.metadata->>'initial_guest_readiness_acceptance','false')) in ('true','yes','1') then 'Final clean, photograph + Guest Readiness acceptance' when coalesce(new.metadata->>'rhythm_target_state','')='fallen_out_of_rhythm' then 'Restore guest readiness — '||coalesce(nullif(v_zone.label,''),'Venue') else 'Guest readiness walk — '||coalesce(nullif(v_zone.label,''),'Venue') end;
    new.task_type := 'guest_readiness_round';new.action_key := 'guest_readiness';new.work_class := 'light';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('task_style','guest_readiness_round','structured_result_required',true,'venue_zone_id',v_zone.id,'venue_zone_label',v_zone.label,'display_action','Check guest readiness','display_subject',coalesce(nullif(v_zone.label,''),'Venue'),'display_detail','Entry · Bathroom · Kitchen · Lounge · Library · Conference Room · Studio','collection_zone',coalesce(nullif(v_zone.label,''),'Venue'),'work_rhythm','Guest Readiness','time_claims_physical_condition',false);
  elsif v_rhythm='mowing' then
    select go.* into v_object from atlas.rhythm_state rs join atlas.growing_objects go on go.id=rs.subject_id where rs.id=v_state_id and rs.subject_kind='growing_object';
    new.title := case when coalesce(new.metadata->>'rhythm_target_state','')='fallen_out_of_rhythm' then 'Restore mowing rhythm — '||coalesce(nullif(v_object.label,''),'Mowing route') else 'Mow — '||coalesce(nullif(v_object.label,''),'Mowing route') end;
    new.task_type := 'mowing';new.action_key := 'mow';new.work_class := 'standard';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('task_style','mowing_round','structured_result_required',true,'clock_managed',true,'mowing_route_object_id',v_object.id,'mowing_route_key',v_object.stable_key,'display_action','Mow','display_subject',coalesce(nullif(v_object.label,''),'Mowing route'),'display_detail',coalesce(nullif(v_object.metadata->>'equipment_group',''),'Observe the route before choosing a result'),'collection_zone',coalesce(nullif(v_object.metadata->>'zone_label',''),nullif(v_object.label,''),'Mowing'),'work_collection_key','mowing','work_collection_role','member','work_rhythm','Mowing','collection_member_key',v_object.stable_key,'canonical_collection_member_key',v_object.stable_key,'equipment_group',v_object.metadata->>'equipment_group','target_cut_height_inches',v_object.metadata->>'target_cut_height_inches','recreate_on_done',false,'time_claims_physical_condition',false);
  elsif v_rhythm='project_review' then
    select p.* into v_project from atlas.rhythm_state rs join atlas.projects p on p.id=rs.subject_id where rs.id=v_state_id and rs.subject_kind='project';
    new.title := case when coalesce(new.metadata->>'rhythm_target_state','')='fallen_out_of_rhythm' then 'Restore project review — '||coalesce(nullif(v_project.title,''),'Project') else 'Review project — '||coalesce(nullif(v_project.title,''),'Project') end;
    new.task_type := 'project_review';new.action_key := 'review_project';new.work_class := 'owner_decision';new.task_scope := 'project';new.visibility_scope := 'owner';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('task_style','project_review','structured_result_required',true,'clock_managed',true,'project_id',v_project.id,'project_key',v_project.stable_key,'project_title',v_project.title,'display_action','Review project','display_subject',coalesce(nullif(v_project.title,''),'Project'),'display_detail',coalesce(nullif(v_project.current_milestone,''),'Confirm the current move and project health'),'collection_zone','Projects','work_rhythm','Project Review','time_claims_project_health',false);
  elsif v_rhythm in ('germination_watch','harvest_watch') then
    select cc.* into v_cycle from atlas.rhythm_state rs join atlas.crop_cycles cc on cc.id=rs.subject_id where rs.id=v_state_id and rs.subject_kind='crop_cycle';
    if v_cycle.id is not null then
      select * into v_object from atlas.growing_objects where id=v_cycle.object_id;
      if v_rhythm='germination_watch' then
        new.title := 'Check germination — '||coalesce(nullif(v_cycle.crop_label,''),'Crop')||' · '||coalesce(nullif(v_object.label,''),'Growing area');new.task_type := 'germination_check';new.action_key := 'germination_check';new.work_class := 'crop_cycle';
        new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('task_style','germination_check','milestone','germination_check','crop_cycle_id',v_cycle.id,'crop_cycle_key',v_cycle.crop_cycle_key,'crop_label',v_cycle.crop_label,'variety',v_cycle.variety,'object_id',v_cycle.object_id,'object_label',v_object.label,'expected_germination_start',v_cycle.expected_germination_start,'expected_germination_end',v_cycle.expected_germination_end,'display_action','Check germination','display_subject',coalesce(nullif(v_cycle.variety,''),v_cycle.crop_label),'collection_zone',v_object.label,'time_claims_physical_condition',false);
      else
        new.title := 'Harvest watch — '||coalesce(nullif(v_cycle.variety,''),nullif(v_cycle.crop_label,''),'Crop')||' · '||coalesce(nullif(v_object.label,''),'Growing area');new.task_type := 'harvest_watch';new.action_key := 'harvest_watch';new.work_class := 'crop_cycle';
        new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('task_style','harvest_watch','milestone','harvest_watch','structured_result_required',true,'crop_cycle_id',v_cycle.id,'crop_cycle_key',v_cycle.crop_cycle_key,'crop_label',v_cycle.crop_label,'variety',v_cycle.variety,'object_id',v_cycle.object_id,'object_label',v_object.label,'expected_harvest_watch_start',v_cycle.expected_harvest_watch_start,'expected_harvest_watch_end',v_cycle.expected_harvest_watch_end,'display_action','Check harvest stage','display_subject',coalesce(nullif(v_cycle.variety,''),v_cycle.crop_label),'collection_zone',v_object.label,'time_claims_physical_condition',false);
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function atlas.link_biological_clock_task_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_state atlas.rhythm_state%rowtype;v_object_id uuid;
begin
  if new.task_type='grow_room_care' and new.action_key='grow_room_round' and lower(btrim(new.title))='grow room care' then
    select id into v_object_id from atlas.growing_objects where farm_id=new.farm_id and stable_key='grow_room_seed_shelves' limit 1;
    if v_object_id is not null then insert into atlas.task_objects(task_id,object_id,role) values(new.id,v_object_id,'target') on conflict do nothing; end if;
  end if;
  if new.generated_from='rhythm_clock' and new.generated_from_id is not null then
    select * into v_state from atlas.rhythm_state where id=new.generated_from_id;
    if v_state.subject_kind='crop_cycle' then
      insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source) values(new.id,v_state.subject_id,'affects','confirmed','biological_clock_v1') on conflict do nothing;
      select object_id into v_object_id from atlas.crop_cycles where id=v_state.subject_id;
      if v_object_id is not null then insert into atlas.task_objects(task_id,object_id,role) values(new.id,v_object_id,'target') on conflict do nothing; end if;
    elsif v_state.subject_kind='growing_object' then
      insert into atlas.task_objects(task_id,object_id,role) values(new.id,v_state.subject_id,'target') on conflict do nothing;
    elsif v_state.subject_kind='project' then
      insert into atlas.project_task_links(project_id,task_id,link_role,source,metadata)
      values(v_state.subject_id,new.id,'belongs_to','rhythm_clock_v1',jsonb_build_object('rhythm_state_id',v_state.id))
      on conflict(project_id,task_id) do update set source=excluded.source,metadata=atlas.project_task_links.metadata||excluded.metadata,updated_at=now();
    end if;
  end if;
  return new;
end;
$$;

create or replace function atlas.biological_rhythm_dashboard_v1(p_farm_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,atlas as $$
declare v_items jsonb;
begin
  if auth.uid() is null or not atlas.is_farm_owner(p_farm_id) then raise exception 'Only a farm Owner may read farm rhythm controls.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'stateId',rs.id,'bindingId',rs.rhythm_binding_id,'ruleId',rr.id,'rhythmKey',rs.rhythm_key,'ruleKey',rr.rule_key,'ruleLabel',rr.label,'ruleVersion',rr.version,
    'subjectKind',rs.subject_kind,'subjectId',rs.subject_id,
    'subjectLabel',case when rs.subject_kind='growing_object' then (select label from atlas.growing_objects where id=rs.subject_id) when rs.subject_kind='crop_cycle' then (select concat_ws(' · ',coalesce(nullif(variety,''),crop_label),(select label from atlas.growing_objects where id=object_id)) from atlas.crop_cycles where id=rs.subject_id) when rs.subject_kind='zone' then (select label from atlas.zones where id=rs.subject_id) when rs.subject_kind='project' then (select title from atlas.projects where id=rs.subject_id) else rs.subject_id::text end,
    'state',rs.state,'warningAt',rs.warning_at,'dueAt',rs.due_at,'failureAt',rs.failure_at,'currentTaskId',rs.current_task_id,'bindingActive',rb.active,
    'validitySeconds',rr.validity_interval_seconds,'warningSeconds',rr.warning_window_seconds,'graceSeconds',rr.grace_window_seconds,
    'why',case when rs.rhythm_key='grow_room_care' then 'A completed Grow Room round keeps this rhythm valid. Time can open another care round, but it never claims the room is dry or healthy.' when rs.rhythm_key='germination_watch' then 'A sowing opened a germination watch. Only a recorded germination observation renews or closes it; manual rescheduling does not.' when rs.rhythm_key='harvest_watch' then 'A real planting and harvest window opened this watch. Time asks for an observation; only a field result may declare the crop ready, declining, or finished.' when rs.rhythm_key='mowing' then 'A completed mow or an explicit acceptable-no-cut observation renews this route. Time can return the route for attention, but it never claims the grass is long, dry, or safe to mow.' when rs.rhythm_key='project_review' then 'The Owner chose this project review cadence. Time can require a decision, but only a recorded review may change project health, milestone, waiting state, blockage, or completion.' else 'A completed room-by-room Guest Readiness round keeps the venue in rhythm. Time can require another walk, but it never claims a room is dirty or ready.' end,
    'controls',jsonb_build_object('pauseAppliesToRule',true,'canExtendState',true,'canForgiveState',true,'canReviseRule',true)
  ) order by rs.rhythm_key,rs.due_at nulls last),'[]'::jsonb) into v_items
  from atlas.rhythm_state rs join atlas.rhythm_rules rr on rr.id=rs.rhythm_rule_id join atlas.rhythm_bindings rb on rb.id=rs.rhythm_binding_id
  where rs.farm_id=p_farm_id and rs.rhythm_key in ('grow_room_care','germination_watch','harvest_watch','guest_readiness','mowing','project_review');
  return jsonb_build_object('contractVersion','biological_rhythm_dashboard_v1','farmId',p_farm_id,'items',v_items);
end;
$$;

create or replace function atlas.project_task_focus_v1(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,atlas as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  select jsonb_build_object('organizationName',o.name,'project',atlas.portfolio_project_card_v1(p.id),
    'task',jsonb_build_object('taskId',t.id,'title',t.title,'status',t.status,'priority',t.priority,'dueDate',t.due_date,'note',t.note,'blockerText',t.blocker_text,'taskType',t.task_type,'taskScope',t.task_scope,'metadata',t.metadata,'assignedToViewer',t.assigned_user_id=auth.uid(),'createdByViewer',t.created_by_user_id=auth.uid(),'originKind',t.origin_kind,'createdAt',t.created_at,'updatedAt',t.updated_at,'completedAt',t.completed_at),
    'step',(select jsonb_build_object('stepId',ps.id,'title',ps.title,'status',ps.status,'stepOrder',ps.step_order,'linkedTaskId',ps.linked_task_id,'note',ps.note) from atlas.project_steps ps where ps.project_id=p.id and ps.linked_task_id=t.id order by ps.step_order limit 1),
    'permissions',jsonb_build_object('canComplete',t.assigned_user_id=auth.uid() or atlas.is_organization_owner(p.organization_id),'canEdit',t.assigned_user_id=auth.uid() or atlas.is_organization_owner(p.organization_id),'isOrganizationOwner',atlas.is_organization_owner(p.organization_id))) into v_result
  from atlas.project_task_links ptl join atlas.tasks t on t.id=ptl.task_id join atlas.projects p on p.id=ptl.project_id join atlas.organizations o on o.id=p.organization_id
  where t.id=p_task_id and t.task_scope='project' and atlas.can_read_project(p.id) order by ptl.created_at limit 1;
  return v_result;
end;
$$;

create or replace function atlas.owner_operator_project_task_focus_v1(p_effective_account_id uuid,p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,atlas as $$
declare v_context jsonb;v_user_id uuid;v_result jsonb;
begin
  v_context:=atlas.owner_operator_accounts_v1(p_effective_account_id);v_user_id:=(v_context#>>'{effective,userId}')::uuid;
  select jsonb_build_object('organizationName',o.name,'project',atlas.owner_operator_project_card_v1(p_effective_account_id,p.id),
    'task',jsonb_build_object('taskId',t.id,'title',t.title,'status',t.status,'priority',t.priority,'dueDate',t.due_date,'note',t.note,'blockerText',t.blocker_text,'taskType',t.task_type,'taskScope',t.task_scope,'metadata',t.metadata,'assignedToViewer',t.assigned_user_id=v_user_id,'createdByViewer',t.created_by_user_id=v_user_id,'originKind',t.origin_kind,'createdAt',t.created_at,'updatedAt',t.updated_at,'completedAt',t.completed_at),
    'step',(select jsonb_build_object('stepId',ps.id,'title',ps.title,'status',ps.status,'stepOrder',ps.step_order,'linkedTaskId',ps.linked_task_id,'note',ps.note) from atlas.project_steps ps where ps.project_id=p.id and ps.linked_task_id=t.id order by ps.step_order limit 1),
    'permissions',jsonb_build_object('canComplete',atlas.owner_operator_project_access_v1(p_effective_account_id,p.id,'complete') and (t.assigned_user_id=v_user_id or exists(select 1 from atlas.organization_memberships om where om.organization_id=p.organization_id and om.user_id=v_user_id and om.active and om.role='owner')),'canEdit',atlas.owner_operator_project_access_v1(p_effective_account_id,p.id,'complete') and (t.assigned_user_id=v_user_id or exists(select 1 from atlas.organization_memberships om where om.organization_id=p.organization_id and om.user_id=v_user_id and om.active and om.role='owner')),'isOrganizationOwner',exists(select 1 from atlas.organization_memberships om where om.organization_id=p.organization_id and om.user_id=v_user_id and om.active and om.role='owner'))) into v_result
  from atlas.project_task_links ptl join atlas.tasks t on t.id=ptl.task_id join atlas.projects p on p.id=ptl.project_id join atlas.organizations o on o.id=p.organization_id
  where t.id=p_task_id and t.task_scope='project' and atlas.owner_operator_project_access_v1(p_effective_account_id,p.id,'read') order by ptl.created_at limit 1;
  return v_result;
end;
$$;
