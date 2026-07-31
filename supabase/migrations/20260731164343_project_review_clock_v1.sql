-- Govern farm-specific project review through explicit Owner configuration and append-only review evidence.

create table if not exists atlas.project_review_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id),
  farm_id uuid not null references atlas.farms(id),
  project_id uuid not null references atlas.projects(id) on delete cascade,
  task_id uuid references atlas.tasks(id),
  rhythm_state_id uuid references atlas.rhythm_state(id),
  outcome text not null check (outcome in ('on_track','next_move_changed','waiting_external','blocked','complete')),
  reviewed_at timestamptz not null default now(),
  previous_status text,
  resulting_status text,
  previous_health text,
  resulting_health text,
  previous_milestone text,
  next_milestone text,
  next_review_date date,
  note text,
  idempotency_key text not null,
  created_by_user_id uuid,
  effective_membership_id uuid references atlas.farm_memberships(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id,idempotency_key)
);

alter table atlas.project_review_events enable row level security;

drop policy if exists project_review_events_project_read on atlas.project_review_events;
create policy project_review_events_project_read on atlas.project_review_events
for select to authenticated using (atlas.can_read_project(project_id));

revoke insert,update,delete on atlas.project_review_events from anon,authenticated;
grant select on atlas.project_review_events to authenticated;

create or replace function atlas.prevent_project_review_event_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
begin
  raise exception 'Project review evidence is append-only; record a new review instead.';
end;
$$;

drop trigger if exists project_review_events_append_only_v1 on atlas.project_review_events;
create trigger project_review_events_append_only_v1
before update or delete on atlas.project_review_events
for each row execute function atlas.prevent_project_review_event_mutation_v1();

create index if not exists project_review_events_project_time_idx
on atlas.project_review_events(project_id,reviewed_at desc,id desc);
create index if not exists rhythm_state_project_review_idx
on atlas.rhythm_state(farm_id,state,due_at) where rhythm_key='project_review';

create or replace function atlas.project_review_dashboard_v1(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare
  v_project atlas.projects%rowtype;
  v_state atlas.rhythm_state%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_binding atlas.rhythm_bindings%rowtype;
  v_last atlas.project_review_events%rowtype;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  if not atlas.can_read_project(p_project_id) then raise exception 'Project access is not active.' using errcode='42501'; end if;

  select * into v_project from atlas.projects where id=p_project_id;
  if v_project.id is null then raise exception 'Project not found.' using errcode='P0002'; end if;

  if v_project.farm_id is not null then v_role:=atlas.current_farm_role(v_project.farm_id); end if;

  select rs.* into v_state
  from atlas.rhythm_state rs
  where rs.rhythm_key='project_review' and rs.subject_kind='project' and rs.subject_id=v_project.id
  order by rs.updated_at desc limit 1;
  if v_state.id is not null then
    select * into v_rule from atlas.rhythm_rules where id=v_state.rhythm_rule_id;
    select * into v_binding from atlas.rhythm_bindings where id=v_state.rhythm_binding_id;
  end if;
  select * into v_last from atlas.project_review_events where project_id=v_project.id order by reviewed_at desc,id desc limit 1;

  return jsonb_build_object(
    'contractVersion','project_review_dashboard_v1','projectId',v_project.id,'projectTitle',v_project.title,
    'projectKind',v_project.project_kind,'farmId',v_project.farm_id,'configured',v_state.id is not null,
    'supported',v_project.farm_id is not null and v_project.project_kind='farm',
    'unsupportedReason',case when v_project.farm_id is null or v_project.project_kind<>'farm' then 'Cross-farm and organization projects are not forced into a farm Clock.' end,
    'canConfigure',v_role in ('owner','manager'),'stateId',v_state.id,'state',v_state.state,
    'warningAt',v_state.warning_at,'dueAt',v_state.due_at,'failureAt',v_state.failure_at,
    'currentTaskId',v_state.current_task_id,'bindingActive',coalesce(v_binding.active,false),
    'ruleId',v_rule.id,'ruleVersion',v_rule.version,
    'cadenceDays',case when v_rule.id is not null then greatest(1,round(v_rule.validity_interval_seconds/86400.0)::integer) end,
    'warningDays',case when v_rule.id is not null then round(v_rule.warning_window_seconds/86400.0)::integer end,
    'graceDays',case when v_rule.id is not null then round(v_rule.grace_window_seconds/86400.0)::integer end,
    'lastReview',case when v_last.id is null then null else jsonb_build_object(
      'eventId',v_last.id,'outcome',v_last.outcome,'reviewedAt',v_last.reviewed_at,
      'nextReviewDate',v_last.next_review_date,'note',v_last.note,'nextMilestone',v_last.next_milestone) end,
    'project',jsonb_build_object('status',v_project.status,'health',v_project.health_status,
      'currentMilestone',v_project.current_milestone,'lastMovementAt',v_project.last_movement_at)
  );
end;
$$;

create or replace function atlas.configure_project_review_core_v1(
  p_project_id uuid,p_effective_membership_id uuid,p_effective_role text,
  p_cadence_days integer,p_warning_days integer,p_grace_days integer,
  p_first_review_date date,p_reason text,p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare
  v_project atlas.projects%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_binding atlas.rhythm_bindings%rowtype;
  v_state atlas.rhythm_state%rowtype;
  v_existing_state_id uuid;
  v_workflow_event_id uuid;
  v_satisfaction_id uuid;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_target_at timestamptz;
  v_renewal integer;
  v_evaluation jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_role text := lower(coalesce(p_effective_role,''));
begin
  if p_project_id is null or p_effective_membership_id is null then raise exception 'Project and active membership are required.' using errcode='22023'; end if;
  if v_role not in ('owner','manager') then raise exception 'Only an Owner or manager may configure project review.' using errcode='42501'; end if;
  if p_cadence_days is null or p_cadence_days<1 or p_cadence_days>365 then raise exception 'Review cadence must be 1 to 365 days.' using errcode='22023'; end if;
  if p_warning_days is null or p_warning_days<0 or p_warning_days>=p_cadence_days then raise exception 'Warning days must be zero or more and shorter than the cadence.' using errcode='22023'; end if;
  if p_grace_days is null or p_grace_days<0 or p_grace_days>90 then raise exception 'Grace days must be 0 to 90.' using errcode='22023'; end if;
  if p_first_review_date is null or p_first_review_date<v_today then raise exception 'Choose today or a future first review date.' using errcode='22023'; end if;
  if v_reason is null or length(v_reason)>2000 then raise exception 'Record a concise Owner reason for this review rule.' using errcode='22023'; end if;

  select * into v_project from atlas.projects where id=p_project_id for update;
  if v_project.id is null then raise exception 'Project not found.' using errcode='P0002'; end if;
  if v_project.farm_id is null or v_project.project_kind<>'farm' then raise exception 'Only farm-specific projects can enter a farm review Clock.' using errcode='22023'; end if;
  if v_project.status in ('done','archived') then raise exception 'Completed or archived projects cannot start a review Clock.' using errcode='22023'; end if;

  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id and active;
  if v_membership.id is null or v_membership.farm_id<>v_project.farm_id then raise exception 'Active membership for the project farm is required.' using errcode='42501'; end if;
  if not p_operator_mode and (auth.uid() is null or v_membership.user_id<>auth.uid()) then raise exception 'This membership does not belong to the signed-in player.' using errcode='42501'; end if;

  select id into v_existing_state_id from atlas.rhythm_state
  where farm_id=v_project.farm_id and rhythm_key='project_review' and subject_kind='project' and subject_id=v_project.id;
  if v_existing_state_id is not null then raise exception 'This project already has a review rule. Revise it through the Rulebook.' using errcode='22023'; end if;

  insert into atlas.rhythm_rules(
    organization_id,farm_id,rule_key,rhythm_key,version,label,status,applicability,
    validity_interval_seconds,warning_window_seconds,grace_window_seconds,
    qualifying_touches,failure_consequence,player_routing,created_by_user_id,activated_at,owner_reason,metadata
  ) values(
    v_project.organization_id,v_project.farm_id,'project_review_'||v_project.stable_key,'project_review',1,
    'Project review · '||v_project.title,'active',
    jsonb_build_object('subjectKind','project','projectId',v_project.id,'projectStatus',jsonb_build_array('active','blocked','paused')),
    p_cadence_days*86400,p_warning_days*86400,p_grace_days*86400,
    jsonb_build_array(
      jsonb_build_object('effect','full','sourceKind','project_review','sourceEvent','on_track'),
      jsonb_build_object('effect','full','sourceKind','project_review','sourceEvent','next_move_changed'),
      jsonb_build_object('effect','conditional','sourceKind','project_review','sourceEvent','waiting_external'),
      jsonb_build_object('effect','conditional','sourceKind','project_review','sourceEvent','blocked'),
      jsonb_build_object('effect','full','sourceKind','project_review','sourceEvent','complete')),
    jsonb_build_object(
      'dueTask',jsonb_build_object('title','Review project — '||v_project.title,'priority','normal','taskType','project_review','actionKey','review_project','workClass','owner_decision','note','Review the real project state. Confirm the current move, change it, record waiting or blockage, or complete the project.','visibilityScope','owner','assignedMembershipId',v_membership.id),
      'failureTask',jsonb_build_object('title','Restore project review — '||v_project.title,'priority','high','taskType','project_review','actionKey','review_project','workClass','owner_decision','note','The Owner review point passed without a recorded project decision. Review the current milestone and restore a valid next move.','visibilityScope','owner','assignedMembershipId',v_membership.id),
      'timeClaimsProjectHealth',false),
    jsonb_build_object('visibilityScope','owner','assignedMembershipId',v_membership.id,'assignedUserId',v_membership.user_id,'dueRecipient','owner','failureEscalation','owner'),
    v_membership.user_id,now(),v_reason,
    jsonb_build_object('domain','project_review','boundaryMode','exact_timestamp','timezoneName','America/Chicago','configuredCadenceDays',p_cadence_days,'configuredWarningDays',p_warning_days,'configuredGraceDays',p_grace_days,'timeClaimsProjectHealth',false,'configurationSource','owner_explicit_project_review_v1')
  ) returning * into v_rule;

  insert into atlas.rhythm_bindings(
    organization_id,farm_id,rhythm_rule_id,binding_key,inheritance_layer,subject_kind,subject_id,
    priority,active,active_from,created_by_user_id,owner_reason,metadata
  ) values(
    v_project.organization_id,v_project.farm_id,v_rule.id,'project-review:'||v_project.id::text,
    'subject_override','project',v_project.id,100,true,now(),v_membership.user_id,v_reason,
    jsonb_build_object('projectId',v_project.id,'configurationSource','owner_explicit_project_review_v1')
  ) returning * into v_binding;

  insert into atlas.rhythm_state(
    organization_id,farm_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,subject_kind,subject_id,
    state,effective_rule_version,visibility_scope,assigned_user_id,state_reason,metadata
  ) values(
    v_project.organization_id,v_project.farm_id,v_binding.id,v_rule.id,'project_review','project',v_project.id,
    'uninitialized',v_rule.version,'owner',v_membership.user_id,
    jsonb_build_object('source','owner_explicit_project_review_v1','projectHealthClaim','unknown_until_reviewed'),
    jsonb_build_object('projectId',v_project.id,'firstReviewDate',p_first_review_date)
  ) returning * into v_state;

  v_target_at:=case when p_first_review_date=v_today then now() else (p_first_review_date::timestamp+time '08:00') at time zone 'America/Chicago' end;
  v_renewal:=greatest(1,ceil(extract(epoch from (v_target_at-now())))::integer);

  insert into atlas.workflow_events(farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload,created_at)
  values(v_project.farm_id,'project-review-config:'||v_state.id::text||':'||p_first_review_date::text,'project',v_project.id,
    'project_review:'||v_project.id::text,'game_master_satisfaction',v_today,
    jsonb_build_object('rhythm_state_id',v_state.id,'reason',v_reason,'renewal_interval_seconds',v_renewal,'first_review_date',p_first_review_date,'clock_version','rhythm_clock_v1'),now())
  returning id into v_workflow_event_id;

  insert into atlas.rhythm_satisfactions(
    organization_id,farm_id,rhythm_state_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,subject_kind,subject_id,
    satisfaction_key,satisfaction_kind,satisfied_at,renewal_interval_seconds,source_kind,source_id,source_event,
    source_workflow_event_id,source_project_id,policy_match,evidence,created_by_user_id
  ) values(
    v_project.organization_id,v_project.farm_id,v_state.id,v_binding.id,v_rule.id,'project_review','project',v_project.id,
    'project-review-config:'||v_state.id::text||':'||p_first_review_date::text,'game_master',now(),v_renewal,
    'owner_action',v_workflow_event_id,'game_master_satisfaction',v_workflow_event_id,v_project.id,
    jsonb_build_object('matchKind','owner_configured_review_start','reason',v_reason),
    jsonb_build_object('workflowEventId',v_workflow_event_id,'firstReviewDate',p_first_review_date,'cadenceDays',p_cadence_days),v_membership.user_id
  ) returning id into v_satisfaction_id;

  update atlas.rhythm_state set last_qualifying_satisfaction_id=v_satisfaction_id,lease_started_at=now(),updated_at=now() where id=v_state.id;
  v_evaluation:=atlas.evaluate_rhythm_binding_v1(v_state.id,case when p_first_review_date=v_today then now()+interval '2 seconds' else now() end,'project_review_configured');
  return jsonb_build_object('contractVersion','project_review_configure_v1','projectId',v_project.id,'stateId',v_state.id,'ruleId',v_rule.id,'bindingId',v_binding.id,'evaluation',v_evaluation);
end;
$$;

create or replace function atlas.configure_project_review_for_member_v1(
  p_project_id uuid,p_cadence_days integer,p_warning_days integer,p_grace_days integer,p_first_review_date date,p_reason text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas,auth as $$
declare v_project atlas.projects%rowtype;v_role text;v_membership uuid;
begin
  select * into v_project from atlas.projects where id=p_project_id;
  if v_project.id is null or v_project.farm_id is null then raise exception 'Farm project not found.' using errcode='P0002'; end if;
  v_role:=atlas.current_farm_role(v_project.farm_id);v_membership:=atlas.current_membership_id(v_project.farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.configure_project_review_core_v1(p_project_id,v_membership,v_role,p_cadence_days,p_warning_days,p_grace_days,p_first_review_date,p_reason,false);
end;
$$;

create or replace function atlas.owner_operator_configure_project_review_v1(
  p_effective_membership_id uuid,p_project_id uuid,p_cadence_days integer,p_warning_days integer,p_grace_days integer,p_first_review_date date,p_reason text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas,auth as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.configure_project_review_core_v1(p_project_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_cadence_days,p_warning_days,p_grace_days,p_first_review_date,p_reason,true);
end;
$$;

create or replace function atlas.record_project_review_result_core_v1(
  p_task_id uuid,p_effective_membership_id uuid,p_effective_role text,p_outcome text,
  p_next_milestone text,p_next_review_date date,p_note text,p_idempotency_key text,p_operator_mode boolean default false
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas,auth as $$
declare
  v_task atlas.tasks%rowtype;v_membership atlas.farm_memberships%rowtype;v_state atlas.rhythm_state%rowtype;
  v_rule atlas.rhythm_rules%rowtype;v_binding atlas.rhythm_bindings%rowtype;v_project atlas.projects%rowtype;
  v_existing atlas.project_review_events%rowtype;v_event_id uuid;v_satisfaction_id uuid;v_transition jsonb;v_clock jsonb;
  v_role text:=lower(coalesce(p_effective_role,''));v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_milestone text:=nullif(btrim(coalesce(p_next_milestone,'')),'');v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_now timestamptz:=now();v_today date:=(now() at time zone 'America/Chicago')::date;v_renewal integer;v_target_at timestamptz;
  v_result_status text;v_result_health text;v_journal_id uuid;
begin
  if p_task_id is null or p_effective_membership_id is null or v_key is null or length(v_key)>160 then raise exception 'Task, active membership, and idempotency key are required.' using errcode='22023'; end if;
  if p_outcome not in ('on_track','next_move_changed','waiting_external','blocked','complete') then raise exception 'Choose a valid project review result.' using errcode='22023'; end if;
  if v_role not in ('owner','manager') then raise exception 'Only an Owner or manager may record a project review.' using errcode='42501'; end if;
  if v_note is not null and length(v_note)>4000 then raise exception 'Review note must be 4000 characters or fewer.' using errcode='22023'; end if;
  if v_milestone is not null and length(v_milestone)>500 then raise exception 'Next move must be 500 characters or fewer.' using errcode='22023'; end if;
  if p_outcome='next_move_changed' and v_milestone is null then raise exception 'Record the new current move.' using errcode='22023'; end if;
  if p_outcome in ('waiting_external','blocked') and v_note is null then raise exception 'Describe what the project is waiting on or what is blocked.' using errcode='22023'; end if;
  if p_outcome in ('waiting_external','blocked') and (p_next_review_date is null or p_next_review_date<=v_today) then raise exception 'Choose a future review date for a waiting or blocked project.' using errcode='22023'; end if;
  if p_next_review_date is not null and p_next_review_date<=v_today then raise exception 'Next review date must be in the future.' using errcode='22023'; end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Project review task was not found.' using errcode='P0002'; end if;
  if v_task.status not in ('open','blocked') or v_task.task_type<>'project_review' or coalesce(v_task.metadata->>'task_style','')<>'project_review' then raise exception 'This task is not an open Clock-governed project review.' using errcode='22023'; end if;
  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id and active;
  if v_membership.id is null or v_membership.farm_id<>v_task.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if not p_operator_mode and (auth.uid() is null or v_membership.user_id<>auth.uid()) then raise exception 'This membership does not belong to the signed-in player.' using errcode='42501'; end if;

  select rs.* into v_state from atlas.rhythm_state rs where rs.id=atlas.rhythm_safe_uuid_v1(v_task.metadata->>'rhythm_state_id') and rs.farm_id=v_task.farm_id and rs.rhythm_key='project_review' and rs.subject_kind='project' for update;
  if v_state.id is null then raise exception 'Project review Clock state was not found.' using errcode='P0002'; end if;
  select * into v_rule from atlas.rhythm_rules where id=v_state.rhythm_rule_id;
  select * into v_binding from atlas.rhythm_bindings where id=v_state.rhythm_binding_id for update;
  select * into v_project from atlas.projects where id=v_state.subject_id and farm_id=v_task.farm_id for update;
  if v_project.id is null then raise exception 'Project was not found.' using errcode='P0002'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_task.farm_id::text||':project-review:'||v_key,0));
  select * into v_existing from atlas.project_review_events where farm_id=v_task.farm_id and idempotency_key=v_key;
  if v_existing.id is not null then return jsonb_build_object('eventId',v_existing.id,'taskId',v_existing.task_id,'outcome',v_existing.outcome,'deduplicated',true); end if;

  v_result_status:=case p_outcome when 'blocked' then 'blocked' when 'complete' then 'done' else 'active' end;
  v_result_health:=case p_outcome when 'waiting_external' then 'waiting' when 'blocked' then 'blocked' when 'complete' then 'complete' else 'moving' end;

  insert into atlas.project_review_events(
    organization_id,farm_id,project_id,task_id,rhythm_state_id,outcome,reviewed_at,
    previous_status,resulting_status,previous_health,resulting_health,previous_milestone,next_milestone,
    next_review_date,note,idempotency_key,created_by_user_id,effective_membership_id,metadata
  ) values(
    v_project.organization_id,v_project.farm_id,v_project.id,v_task.id,v_state.id,p_outcome,v_now,
    v_project.status,v_result_status,v_project.health_status,v_result_health,v_project.current_milestone,v_milestone,
    p_next_review_date,v_note,v_key,auth.uid(),v_membership.id,
    jsonb_build_object('operatorMode',coalesce(p_operator_mode,false),'ruleVersion',v_rule.version,'timeClaimsProjectHealth',false)
  ) returning id into v_event_id;

  update atlas.projects set status=v_result_status,health_status=v_result_health,
    current_milestone=case when p_outcome='complete' then null when v_milestone is not null then v_milestone else current_milestone end,
    last_movement_at=case when p_outcome in ('next_move_changed','waiting_external','blocked','complete') then v_now else last_movement_at end,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_project_review_event_id',v_event_id,'last_reviewed_at',v_now,'last_review_outcome',p_outcome),updated_at=v_now
  where id=v_project.id;

  if p_outcome in ('on_track','next_move_changed') then
    update atlas.project_attention_items set status='resolved',resolved_at=v_now,updated_at=v_now where project_id=v_project.id and status='open' and coalesce(metadata->>'projectReviewRhythm','false')='true';
  elsif p_outcome='waiting_external' then
    update atlas.project_attention_items set status='resolved',resolved_at=v_now,updated_at=v_now where project_id=v_project.id and status='open' and coalesce(metadata->>'projectReviewRhythm','false')='true';
    insert into atlas.project_attention_items(project_id,attention_type,title,detail,status,assigned_user_id,due_date,metadata)
    values(v_project.id,'external_dependency','Waiting · '||v_project.title,v_note,'open',v_membership.user_id,p_next_review_date,jsonb_build_object('projectReviewRhythm',true,'projectReviewEventId',v_event_id));
  elsif p_outcome='blocked' then
    update atlas.project_attention_items set status='resolved',resolved_at=v_now,updated_at=v_now where project_id=v_project.id and status='open' and coalesce(metadata->>'projectReviewRhythm','false')='true';
    insert into atlas.project_attention_items(project_id,attention_type,title,detail,status,assigned_user_id,due_date,metadata)
    values(v_project.id,'blocked','Blocked · '||v_project.title,v_note,'open',v_membership.user_id,p_next_review_date,jsonb_build_object('projectReviewRhythm',true,'projectReviewEventId',v_event_id));
  else
    update atlas.project_attention_items set status='resolved',resolved_at=v_now,updated_at=v_now where project_id=v_project.id and status='open' and coalesce(metadata->>'projectReviewRhythm','false')='true';
  end if;

  if p_next_review_date is not null then
    v_target_at:=(p_next_review_date::timestamp+time '08:00') at time zone 'America/Chicago';
    v_renewal:=greatest(1,ceil(extract(epoch from (v_target_at-v_now)))::integer);
  end if;

  insert into atlas.rhythm_satisfactions(
    organization_id,farm_id,rhythm_state_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,subject_kind,subject_id,
    satisfaction_key,satisfaction_kind,satisfied_at,renewal_interval_seconds,source_kind,source_id,source_event,
    source_task_id,source_project_id,policy_match,evidence,created_by_user_id
  ) values(
    v_project.organization_id,v_project.farm_id,v_state.id,v_state.rhythm_binding_id,v_state.rhythm_rule_id,'project_review','project',v_project.id,
    'project-review:'||v_event_id::text,case when p_outcome in ('waiting_external','blocked') then 'conditional' else 'full' end,
    v_now,v_renewal,'project_review',v_event_id,p_outcome,v_task.id,v_project.id,
    jsonb_build_object('matchKind','structured_project_review','ruleKey',v_rule.rule_key),
    jsonb_build_object('projectReviewEventId',v_event_id,'taskId',v_task.id,'projectId',v_project.id,'nextReviewDate',p_next_review_date),auth.uid()
  ) returning id into v_satisfaction_id;

  v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done','project-review:'||v_key||':done',null,
    coalesce(v_note,case p_outcome when 'on_track' then 'Project reviewed and remains on track.' when 'next_move_changed' then 'Project reviewed; current move changed.' when 'waiting_external' then 'Project reviewed; waiting on an external dependency.' when 'blocked' then 'Project reviewed; blocker recorded.' else 'Project completed.' end),
    null,'project_review',p_outcome,jsonb_build_object('project_review_event_id',v_event_id,'project_id',v_project.id,'next_review_date',p_next_review_date,'next_milestone',v_milestone),null);

  update atlas.rhythm_state set last_qualifying_satisfaction_id=v_satisfaction_id,current_task_id=null,current_occurrence_id=null,recovery_started_at=null,updated_at=v_now where id=v_state.id;

  if p_outcome='complete' then
    update atlas.rhythm_bindings set active=false,active_until=v_now,owner_reason=coalesce(v_note,'Project completed.'),updated_at=v_now where id=v_binding.id;
    update atlas.rhythm_state set state='paused',state_reason=jsonb_build_object('source','project_review','eventId',v_event_id,'outcome','complete'),last_evaluated_at=v_now,last_transition_at=v_now,updated_at=v_now where id=v_state.id;
    v_clock:=jsonb_build_object('state','paused','reason','project_complete');
  else
    v_clock:=atlas.evaluate_rhythm_binding_v1(v_state.id,v_now,'project_review_result');
  end if;

  v_journal_id:=atlas.upsert_journal_event_v1(
    p_organization_id=>v_project.organization_id,p_farm_id=>v_project.farm_id,p_event_key=>'project-review:'||v_event_id::text,
    p_event_kind=>'state_change',p_source_kind=>'project_review_event',p_source_id=>v_event_id,p_source_event=>p_outcome,
    p_occurred_at=>v_now,p_journal_date=>v_today,p_title=>'Project reviewed — '||v_project.title,
    p_detail=>coalesce(v_note,replace(p_outcome,'_',' ')),p_visibility_scope=>'project_shared',
    p_importance=>case when p_outcome='blocked' then 'attention' when p_outcome='complete' then 'normal' else 'quiet' end,
    p_assigned_user_id=>null,p_task_id=>v_task.id,p_object_id=>null,p_crop_cycle_id=>null,p_project_id=>v_project.id,
    p_payload=>jsonb_build_object('projectReviewEventId',v_event_id,'outcome',p_outcome,'nextMilestone',v_milestone,'nextReviewDate',p_next_review_date,'resultingHealth',v_result_health),
    p_provenance=>jsonb_build_object('adapter','project_review_v1','source_table','atlas.project_review_events','event_id',v_event_id));

  return jsonb_build_object('contractVersion','project_review_result_v1','eventId',v_event_id,'taskId',v_task.id,'projectId',v_project.id,'outcome',p_outcome,'resultingStatus',v_result_status,'resultingHealth',v_result_health,'journalEventId',v_journal_id,'clock',v_clock);
end;
$$;

create or replace function atlas.record_project_review_result_for_member_v1(
  p_farm_id uuid,p_task_id uuid,p_outcome text,p_next_milestone text,p_next_review_date date,p_note text,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas,auth as $$
declare v_role text;v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id);v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_project_review_result_core_v1(p_task_id,v_membership,v_role,p_outcome,p_next_milestone,p_next_review_date,p_note,p_idempotency_key,false);
end;
$$;

create or replace function atlas.owner_operator_record_project_review_result_v1(
  p_effective_membership_id uuid,p_task_id uuid,p_outcome text,p_next_milestone text,p_next_review_date date,p_note text,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas,auth as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_project_review_result_core_v1(p_task_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_outcome,p_next_milestone,p_next_review_date,p_note,p_idempotency_key,true);
end;
$$;

grant execute on function atlas.project_review_dashboard_v1(uuid) to authenticated;
grant execute on function atlas.configure_project_review_for_member_v1(uuid,integer,integer,integer,date,text) to authenticated;
grant execute on function atlas.owner_operator_configure_project_review_v1(uuid,uuid,integer,integer,integer,date,text) to authenticated;
grant execute on function atlas.record_project_review_result_for_member_v1(uuid,uuid,text,text,date,text,text) to authenticated;
grant execute on function atlas.owner_operator_record_project_review_result_v1(uuid,uuid,text,text,date,text,text) to authenticated;
