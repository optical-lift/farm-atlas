-- Enroll Grow Room care and germination observation in the governed Atlas Clock.

create or replace function atlas.biological_clock_state_from_boundaries_v1(
  p_warning_at timestamptz,
  p_due_at timestamptz,
  p_failure_at timestamptz,
  p_as_of timestamptz default now()
)
returns text
language sql
stable
as $$
  select case
    when p_due_at is null then 'uninitialized'
    when p_failure_at is not null and coalesce(p_as_of, now()) >= p_failure_at then 'fallen_out_of_rhythm'
    when coalesce(p_as_of, now()) >= p_due_at then 'due'
    when p_warning_at is not null and coalesce(p_as_of, now()) >= p_warning_at then 'coming_due'
    else 'resting'
  end;
$$;

revoke all on function atlas.biological_clock_state_from_boundaries_v1(timestamptz,timestamptz,timestamptz,timestamptz) from public, anon, authenticated;

create or replace function atlas.seed_biological_rhythm_state_v1(
  p_binding_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_anchor_at timestamptz,
  p_current_task_id uuid default null,
  p_current_occurrence_id uuid default null,
  p_source_event text default 'biological_clock_enrollment',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_binding atlas.rhythm_bindings%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_state_id uuid;
  v_satisfaction_id uuid;
  v_warning_at timestamptz;
  v_due_at timestamptz;
  v_failure_at timestamptz;
  v_visibility text;
  v_assigned_user_id uuid;
begin
  select * into v_binding from atlas.rhythm_bindings where id=p_binding_id and active;
  if v_binding.id is null then raise exception 'Active rhythm binding not found.' using errcode='P0002'; end if;
  select * into v_rule from atlas.rhythm_rules where id=v_binding.rhythm_rule_id and status='active';
  if v_rule.id is null then raise exception 'Active rhythm rule not found.' using errcode='P0002'; end if;
  if not atlas.rhythm_subject_belongs_to_farm_v1(v_binding.farm_id,p_subject_kind,p_subject_id) then
    raise exception 'Rhythm subject does not belong to farm.' using errcode='22023';
  end if;

  v_visibility := coalesce(nullif(v_rule.player_routing->>'visibilityScope',''),'farm_shared');
  if v_visibility not in ('owner','management','assigned_worker','farm_shared','project_shared','system_internal') then v_visibility := 'farm_shared'; end if;
  v_assigned_user_id := atlas.rhythm_safe_uuid_v1(v_rule.player_routing->>'assignedUserId');

  insert into atlas.rhythm_state(
    organization_id,farm_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,
    subject_kind,subject_id,state,effective_rule_version,visibility_scope,
    assigned_user_id,current_task_id,current_occurrence_id,state_reason,metadata
  ) values (
    v_binding.organization_id,v_binding.farm_id,v_binding.id,v_rule.id,v_rule.rhythm_key,
    p_subject_kind,p_subject_id,'uninitialized',v_rule.version,v_visibility,
    v_assigned_user_id,p_current_task_id,p_current_occurrence_id,
    jsonb_build_object('source','biological_clock_enrollment_v1'),
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('biologicalClock',true,'baselineEnrollment',true)
  )
  on conflict (farm_id,rhythm_key,subject_kind,subject_id) do update
    set rhythm_binding_id=excluded.rhythm_binding_id,
        rhythm_rule_id=excluded.rhythm_rule_id,
        effective_rule_version=excluded.effective_rule_version,
        visibility_scope=excluded.visibility_scope,
        assigned_user_id=coalesce(excluded.assigned_user_id,atlas.rhythm_state.assigned_user_id),
        current_task_id=coalesce(excluded.current_task_id,atlas.rhythm_state.current_task_id),
        current_occurrence_id=coalesce(excluded.current_occurrence_id,atlas.rhythm_state.current_occurrence_id),
        metadata=atlas.rhythm_state.metadata || excluded.metadata,
        updated_at=now()
  returning id into v_state_id;

  insert into atlas.rhythm_satisfactions(
    organization_id,farm_id,rhythm_state_id,rhythm_binding_id,rhythm_rule_id,
    rhythm_key,subject_kind,subject_id,satisfaction_key,satisfaction_kind,
    satisfied_at,renewal_interval_seconds,source_kind,source_id,source_event,
    policy_match,evidence
  ) values (
    v_binding.organization_id,v_binding.farm_id,v_state_id,v_binding.id,v_rule.id,
    v_rule.rhythm_key,p_subject_kind,p_subject_id,
    'biological-baseline:'||v_state_id::text||':'||extract(epoch from p_anchor_at)::bigint::text,
    'conditional',p_anchor_at,v_rule.validity_interval_seconds,
    'biological_clock',p_subject_id,p_source_event,
    jsonb_build_object('enrollment',true,'physicalConditionClaimed',false),
    jsonb_build_object('anchorAt',p_anchor_at,'metadata',coalesce(p_metadata,'{}'::jsonb))
  ) on conflict (farm_id,satisfaction_key) do update
    set evidence=atlas.rhythm_satisfactions.evidence || excluded.evidence
  returning id into v_satisfaction_id;

  v_warning_at := atlas.rhythm_boundary_at_v1(p_anchor_at,greatest(0,v_rule.validity_interval_seconds-v_rule.warning_window_seconds),'America/Chicago',coalesce(nullif(v_rule.metadata->>'boundaryMode',''),'exact_timestamp'));
  v_due_at := atlas.rhythm_boundary_at_v1(p_anchor_at,v_rule.validity_interval_seconds,'America/Chicago',coalesce(nullif(v_rule.metadata->>'boundaryMode',''),'exact_timestamp'));
  v_failure_at := atlas.rhythm_boundary_at_v1(p_anchor_at,v_rule.validity_interval_seconds+v_rule.grace_window_seconds,'America/Chicago',coalesce(nullif(v_rule.metadata->>'boundaryMode',''),'exact_timestamp'));

  update atlas.rhythm_state
  set last_qualifying_satisfaction_id=v_satisfaction_id,
      lease_started_at=p_anchor_at,
      warning_at=v_warning_at,
      due_at=v_due_at,
      failure_at=v_failure_at,
      state=atlas.biological_clock_state_from_boundaries_v1(v_warning_at,v_due_at,v_failure_at,now()),
      last_evaluated_at=now(),
      state_reason=jsonb_build_object('source','biological_clock_enrollment_v1','baseline',true,'physicalConditionClaimed',false),
      updated_at=now()
  where id=v_state_id;

  return v_state_id;
end;
$$;

revoke all on function atlas.seed_biological_rhythm_state_v1(uuid,text,uuid,timestamptz,uuid,uuid,text,jsonb) from public,anon,authenticated;

create or replace function atlas.decorate_biological_clock_task_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_rhythm text := coalesce(new.metadata->>'rhythm_key','');
  v_state_id uuid := atlas.rhythm_safe_uuid_v1(new.metadata->>'rhythm_state_id');
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
begin
  if new.generated_from <> 'rhythm_clock' or v_state_id is null then return new; end if;

  if v_rhythm='grow_room_care' then
    new.title := 'Grow Room Care';
    new.task_type := 'grow_room_care';
    new.action_key := 'grow_room_round';
    new.work_class := 'standard';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'manual_top_level_card',true,
      'round_completion_required',true,
      'display_action','Care round',
      'display_subject','Grow Room',
      'collection_zone','Grow Room',
      'work_rhythm','Grow Room Care',
      'time_claims_physical_condition',false
    );
  elsif v_rhythm='germination_watch' then
    select cc.* into v_cycle
    from atlas.rhythm_state rs join atlas.crop_cycles cc on cc.id=rs.subject_id
    where rs.id=v_state_id and rs.subject_kind='crop_cycle';
    if v_cycle.id is not null then
      select * into v_object from atlas.growing_objects where id=v_cycle.object_id;
      new.title := 'Check germination — '||coalesce(nullif(v_cycle.crop_label,''),'Crop')||' · '||coalesce(nullif(v_object.label,''),'Growing area');
      new.task_type := 'germination_check';
      new.action_key := 'germination_check';
      new.work_class := 'crop_cycle';
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'task_style','germination_check',
        'milestone','germination_check',
        'crop_cycle_id',v_cycle.id,
        'crop_cycle_key',v_cycle.crop_cycle_key,
        'crop_label',v_cycle.crop_label,
        'variety',v_cycle.variety,
        'object_id',v_cycle.object_id,
        'object_label',v_object.label,
        'expected_germination_start',v_cycle.expected_germination_start,
        'expected_germination_end',v_cycle.expected_germination_end,
        'display_action','Check germination',
        'display_subject',coalesce(nullif(v_cycle.variety,''),v_cycle.crop_label),
        'collection_zone',v_object.label,
        'time_claims_physical_condition',false
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_decorate_biological_clock_v1 on atlas.tasks;
create trigger tasks_decorate_biological_clock_v1
before insert or update of generated_from,generated_from_id,metadata on atlas.tasks
for each row execute function atlas.decorate_biological_clock_task_v1();

create or replace function atlas.link_biological_clock_task_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_state atlas.rhythm_state%rowtype;
  v_object_id uuid;
begin
  if new.task_type='grow_room_care' and new.action_key='grow_room_round' and lower(btrim(new.title))='grow room care' then
    select id into v_object_id from atlas.growing_objects where farm_id=new.farm_id and stable_key='grow_room_seed_shelves' limit 1;
    if v_object_id is not null then
      insert into atlas.task_objects(task_id,object_id,role) values(new.id,v_object_id,'target') on conflict do nothing;
    end if;
  end if;

  if new.generated_from='rhythm_clock' and new.generated_from_id is not null then
    select * into v_state from atlas.rhythm_state where id=new.generated_from_id;
    if v_state.subject_kind='crop_cycle' then
      insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source)
      values(new.id,v_state.subject_id,'affects','confirmed','biological_clock_v1') on conflict do nothing;
      select object_id into v_object_id from atlas.crop_cycles where id=v_state.subject_id;
      if v_object_id is not null then
        insert into atlas.task_objects(task_id,object_id,role) values(new.id,v_object_id,'target') on conflict do nothing;
      end if;
    elsif v_state.subject_kind='growing_object' then
      insert into atlas.task_objects(task_id,object_id,role) values(new.id,v_state.subject_id,'target') on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_link_biological_clock_v1 on atlas.tasks;
create trigger tasks_link_biological_clock_v1
after insert or update of generated_from,generated_from_id,task_type,action_key,title on atlas.tasks
for each row execute function atlas.link_biological_clock_task_v1();

create or replace function atlas.enroll_germination_watch_v1(p_crop_cycle_id uuid,p_task_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_binding atlas.rhythm_bindings%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_task atlas.tasks%rowtype;
  v_due_date date;
  v_due_at timestamptz;
  v_anchor_at timestamptz;
  v_state_id uuid;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then return jsonb_build_object('enrolled',false,'reason','cycle_not_found'); end if;

  if v_cycle.lifecycle_status not in ('active','planned') or v_cycle.sown_date is null
     or v_cycle.cycle_state not in ('sown','germinating','germination_pending','emerging') then
    update atlas.rhythm_state set state='paused',state_reason=jsonb_build_object('source','germination_stage_exit','cycleState',v_cycle.cycle_state),updated_at=now()
    where farm_id=v_cycle.farm_id and rhythm_key='germination_watch' and subject_kind='crop_cycle' and subject_id=v_cycle.id;
    return jsonb_build_object('enrolled',false,'reason','not_waiting_on_germination','cycleState',v_cycle.cycle_state);
  end if;

  select b.* into v_binding
  from atlas.rhythm_bindings b join atlas.rhythm_rules r on r.id=b.rhythm_rule_id
  where b.farm_id=v_cycle.farm_id and b.active and b.subject_kind='crop_stage' and b.subject_key=v_cycle.cycle_state
    and r.rhythm_key='germination_watch' and r.status='active'
  order by b.priority desc,b.created_at desc limit 1;
  if v_binding.id is null then return jsonb_build_object('enrolled',false,'reason','no_active_stage_rule'); end if;
  select * into v_rule from atlas.rhythm_rules where id=v_binding.rhythm_rule_id;

  if p_task_id is not null then select * into v_task from atlas.tasks where id=p_task_id and farm_id=v_cycle.farm_id; end if;
  if v_task.id is null then
    select t.* into v_task from atlas.tasks t
    join atlas.task_crop_cycles tcc on tcc.task_id=t.id and tcc.crop_cycle_id=v_cycle.id
    where t.status in ('open','blocked') and (t.task_type='germination_check' or coalesce(t.metadata->>'task_style','')='germination_check')
    order by t.due_date nulls last,t.created_at limit 1;
  end if;

  v_due_date := coalesce(v_task.due_date,v_cycle.expected_germination_start,v_cycle.sown_date+1);
  v_due_at := make_timestamptz(extract(year from v_due_date)::int,extract(month from v_due_date)::int,extract(day from v_due_date)::int,8,0,0,'America/Chicago');
  v_anchor_at := v_due_at - make_interval(secs=>v_rule.validity_interval_seconds);
  v_state_id := atlas.seed_biological_rhythm_state_v1(v_binding.id,'crop_cycle',v_cycle.id,v_anchor_at,v_task.id,v_task.planned_occurrence_id,'germination_window_open',jsonb_build_object('dueDate',v_due_date,'cycleState',v_cycle.cycle_state,'physicalConditionClaimed',false));

  if v_task.id is not null then
    update atlas.tasks set action_key='germination_check',work_class='crop_cycle',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('rhythm_state_id',v_state_id,'rhythm_key','germination_watch','clock_managed',true),updated_at=now()
    where id=v_task.id;
  end if;
  return jsonb_build_object('enrolled',true,'stateId',v_state_id,'taskId',v_task.id,'dueDate',v_due_date);
end;
$$;

revoke all on function atlas.enroll_germination_watch_v1(uuid,uuid) from public,anon,authenticated;

create or replace function atlas.sync_germination_watch_from_cycle_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,atlas as $$
begin
  perform atlas.enroll_germination_watch_v1(new.id,null);
  return new;
end; $$;

drop trigger if exists crop_cycles_sync_germination_watch_v1 on atlas.crop_cycles;
create trigger crop_cycles_sync_germination_watch_v1
after insert or update of cycle_state,lifecycle_status,sown_date,expected_germination_start,expected_germination_end on atlas.crop_cycles
for each row execute function atlas.sync_germination_watch_from_cycle_v1();

create or replace function atlas.sync_germination_watch_from_task_link_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_task atlas.tasks%rowtype;
begin
  select * into v_task from atlas.tasks where id=new.task_id;
  if v_task.task_type='germination_check' or coalesce(v_task.metadata->>'task_style','')='germination_check' then
    perform atlas.enroll_germination_watch_v1(new.crop_cycle_id,new.task_id);
  end if;
  return new;
end; $$;

drop trigger if exists task_crop_cycles_sync_germination_watch_v1 on atlas.task_crop_cycles;
create trigger task_crop_cycles_sync_germination_watch_v1
after insert or update of crop_cycle_id on atlas.task_crop_cycles
for each row execute function atlas.sync_germination_watch_from_task_link_v1();

create or replace function atlas.emit_germination_observation_v1(
  p_task_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_task atlas.tasks%rowtype;
  v_cycle_id uuid;
  v_event_id uuid;
  v_count integer:=0;
  v_action text:=lower(btrim(coalesce(p_action,'')));
begin
  if v_action not in ('not_yet','beginning','germinated','failed_or_uncertain','problem_found') then
    raise exception 'Unsupported germination observation.' using errcode='22023';
  end if;
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Germination task not found.' using errcode='P0002'; end if;

  for v_cycle_id in select distinct tcc.crop_cycle_id from atlas.task_crop_cycles tcc where tcc.task_id=v_task.id loop
    insert into atlas.workflow_events(farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload)
    values(
      v_task.farm_id,
      'germination-observation:'||v_task.id::text||':'||v_cycle_id::text||':'||v_action||':'||coalesce(v_task.updated_at,now())::text,
      'crop_cycle',v_cycle_id,v_cycle_id::text,'germination_observed:'||v_action,
      (now() at time zone 'America/Chicago')::date,
      jsonb_build_object('taskId',v_task.id,'action',v_action,'note',nullif(btrim(coalesce(p_note,'')),''),'physicalObservationRecorded',true,'timeClaimsPhysicalCondition',false)
    ) on conflict (farm_id,event_key) do update set payload=excluded.payload
    returning id into v_event_id;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('events',v_count,'lastEventId',v_event_id);
end;
$$;

revoke all on function atlas.emit_germination_observation_v1(uuid,text,text) from public,anon,authenticated;

create or replace function atlas.record_germination_observation_for_member_v2(
  p_farm_id uuid,
  p_task_id uuid,
  p_task_title text default null,
  p_action text default null,
  p_spacing_outcome text default null,
  p_target_spacing_inches numeric default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_base jsonb;
  v_handoff jsonb;
  v_issue text;
begin
  if v_action in ('not_yet','beginning','failed_or_uncertain','problem_found') then
    v_base:=atlas.record_germination_check_for_member_v1(p_farm_id,p_task_id,p_task_title,'not_yet',null,null);
  elsif v_action='germinated' then
    v_base:=atlas.record_germination_check_for_member_v1(p_farm_id,p_task_id,p_task_title,'germinated',p_spacing_outcome,p_target_spacing_inches);
  else
    raise exception 'Choose not yet, beginning, germinated, failed or uncertain, or problem found.' using errcode='22023';
  end if;

  if v_action='beginning' then
    update atlas.crop_cycles cc set cycle_state='emerging',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('germination_result','beginning','germination_recorded_at',now()),updated_at=now()
    where cc.id in (select crop_cycle_id from atlas.task_crop_cycles where task_id=p_task_id)
      and cc.cycle_state in ('sown','germinating','germination_pending','emerging');
  elsif v_action in ('failed_or_uncertain','problem_found') then
    v_issue:=coalesce(nullif(btrim(coalesce(p_note,'')),''),case when v_action='problem_found' then 'A problem was found during the germination check.' else 'Germination appears failed or uncertain and needs Owner review.' end);
    v_handoff:=atlas.worker_open_task_problem_handoff_v1(p_task_id,v_issue,'germination:'||v_action||':'||p_task_id::text||':'||(now() at time zone 'America/Chicago')::date::text);
  end if;

  perform atlas.emit_germination_observation_v1(p_task_id,v_action,p_note);
  return v_base||jsonb_build_object('action',v_action,'handoff',v_handoff,'biologicalObservation',true);
end;
$$;

grant execute on function atlas.record_germination_observation_for_member_v2(uuid,uuid,text,text,text,numeric,text) to authenticated;
revoke all on function atlas.record_germination_observation_for_member_v2(uuid,uuid,text,text,text,numeric,text) from anon;

create or replace function atlas.owner_operator_record_germination_observation_v2(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_action text,
  p_spacing_outcome text default null,
  p_target_spacing_inches numeric default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_farm_id uuid;
  v_membership_id uuid;
  v_role text;
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_base jsonb;
  v_owner_membership_id uuid;
  v_handoff_id uuid;
  v_issue text;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id:=(v_context->>'farmId')::uuid;
  v_membership_id:=(v_context#>>'{effective,membershipId}')::uuid;
  v_role:=v_context#>>'{effective,role}';
  select * into v_task from atlas.tasks where id=p_task_id and farm_id=v_farm_id for update;
  if v_task.id is null then raise exception 'Germination check task was not found.' using errcode='P0002'; end if;
  if v_role not in ('owner','manager','farm_hand') then raise exception 'Selected account cannot record germination.' using errcode='42501'; end if;
  if v_role='farm_hand' and (v_task.visibility_scope<>'assigned_worker' or v_task.assigned_membership_id<>v_membership_id) then
    raise exception 'The germination task is not assigned to the selected worker.' using errcode='42501';
  end if;

  if v_action in ('not_yet','beginning','failed_or_uncertain','problem_found') then
    v_base:=atlas.owner_operator_record_germination_check_v1(p_effective_membership_id,p_task_id,'not_yet',null,null);
  elsif v_action='germinated' then
    v_base:=atlas.owner_operator_record_germination_check_v1(p_effective_membership_id,p_task_id,'germinated',p_spacing_outcome,p_target_spacing_inches);
  else
    raise exception 'Unsupported germination observation.' using errcode='22023';
  end if;

  if v_action='beginning' then
    update atlas.crop_cycles cc set cycle_state='emerging',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('germination_result','beginning','germination_recorded_at',now(),'operatorMode',true),updated_at=now()
    where cc.id in (select crop_cycle_id from atlas.task_crop_cycles where task_id=p_task_id)
      and cc.cycle_state in ('sown','germinating','germination_pending','emerging');
  elsif v_action in ('failed_or_uncertain','problem_found') then
    v_issue:=coalesce(nullif(btrim(coalesce(p_note,'')),''),case when v_action='problem_found' then 'A problem was found during the germination check.' else 'Germination appears failed or uncertain and needs Owner review.' end);
    select id into v_owner_membership_id from atlas.farm_memberships where farm_id=v_farm_id and role='owner' and active order by created_at limit 1;
    insert into atlas.task_problem_handoffs(
      farm_id,task_id,opened_by_user_id,opened_by_membership_id,owner_membership_id,
      original_assigned_membership_id,original_visibility_scope,original_assignee_key,
      issue_text,open_idempotency_key,metadata
    ) values(
      v_farm_id,p_task_id,auth.uid(),v_membership_id,v_owner_membership_id,
      v_task.assigned_membership_id,v_task.visibility_scope,coalesce(v_task.metadata->>'assignee_key',v_context#>>'{effective,workerKey}','anna'),
      v_issue,'operator-germination:'||v_action||':'||p_task_id::text||':'||(now() at time zone 'America/Chicago')::date::text,
      jsonb_build_object('operatorMode',true,'actorUserId',auth.uid(),'effectiveMembershipId',v_membership_id)
    ) on conflict do nothing returning id into v_handoff_id;
    update atlas.tasks set status='blocked',blocker_text=v_issue,assigned_membership_id=v_owner_membership_id,visibility_scope='assigned_worker',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('assignee_key','owner','owner_problem_handoff_open',true,'owner_problem_handoff_id',v_handoff_id,'owner_problem_handoff_issue',v_issue),updated_at=now()
    where id=p_task_id;
  end if;

  perform atlas.emit_germination_observation_v1(p_task_id,v_action,p_note);
  return v_base||jsonb_build_object('action',v_action,'operatorMode',true,'handoffId',v_handoff_id,'biologicalObservation',true);
end;
$$;

grant execute on function atlas.owner_operator_record_germination_observation_v2(uuid,uuid,text,text,numeric,text) to authenticated;
revoke all on function atlas.owner_operator_record_germination_observation_v2(uuid,uuid,text,text,numeric,text) from anon;

create or replace function atlas.biological_rhythm_dashboard_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,atlas
as $$
declare v_items jsonb;
begin
  if auth.uid() is null or not atlas.is_farm_owner(p_farm_id) then raise exception 'Only a farm Owner may read biological rhythm controls.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'stateId',rs.id,'bindingId',rs.rhythm_binding_id,'ruleId',rr.id,'rhythmKey',rs.rhythm_key,'ruleKey',rr.rule_key,'ruleLabel',rr.label,'ruleVersion',rr.version,
    'subjectKind',rs.subject_kind,'subjectId',rs.subject_id,
    'subjectLabel',case when rs.subject_kind='growing_object' then (select label from atlas.growing_objects where id=rs.subject_id) when rs.subject_kind='crop_cycle' then (select concat_ws(' · ',coalesce(nullif(variety,''),crop_label),(select label from atlas.growing_objects where id=object_id)) from atlas.crop_cycles where id=rs.subject_id) else rs.subject_id::text end,
    'state',rs.state,'warningAt',rs.warning_at,'dueAt',rs.due_at,'failureAt',rs.failure_at,'currentTaskId',rs.current_task_id,'bindingActive',rb.active,
    'validitySeconds',rr.validity_interval_seconds,'warningSeconds',rr.warning_window_seconds,'graceSeconds',rr.grace_window_seconds,
    'why',case when rs.rhythm_key='grow_room_care' then 'A completed Grow Room round keeps this rhythm valid. Time can open another care round, but it never claims the room is dry or healthy.' else 'A sowing opened a germination watch. Only a recorded germination observation renews or closes it; manual rescheduling does not.' end,
    'controls',jsonb_build_object('pauseAppliesToRule',true,'canExtendState',true,'canForgiveState',true,'canReviseRule',true)
  ) order by rs.rhythm_key,rs.due_at nulls last), '[]'::jsonb) into v_items
  from atlas.rhythm_state rs join atlas.rhythm_rules rr on rr.id=rs.rhythm_rule_id join atlas.rhythm_bindings rb on rb.id=rs.rhythm_binding_id
  where rs.farm_id=p_farm_id and rs.rhythm_key in ('grow_room_care','germination_watch');
  return jsonb_build_object('contractVersion','biological_rhythm_dashboard_v1','farmId',p_farm_id,'items',v_items);
end;
$$;

grant execute on function atlas.biological_rhythm_dashboard_v1(uuid) to authenticated;
revoke all on function atlas.biological_rhythm_dashboard_v1(uuid) from anon;

create or replace function atlas.owner_control_biological_rhythm_v1(
  p_state_id uuid,
  p_action text,
  p_reason text,
  p_extension_seconds integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_state atlas.rhythm_state%rowtype;
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_result jsonb;
begin
  select * into v_state from atlas.rhythm_state where id=p_state_id;
  if v_state.id is null then raise exception 'Biological rhythm state not found.' using errcode='P0002'; end if;
  if auth.uid() is null or not atlas.is_farm_owner(v_state.farm_id) then raise exception 'Only a farm Owner may control biological rhythms.' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Owner reason is required.' using errcode='22023'; end if;

  if v_action='pause_rule' then
    v_result:=atlas.set_rhythm_binding_active_v1(v_state.rhythm_binding_id,false,p_reason);
  elsif v_action='resume_rule' then
    v_result:=atlas.set_rhythm_binding_active_v1(v_state.rhythm_binding_id,true,p_reason);
    perform atlas.evaluate_rhythm_binding_v1(v_state.id,now(),'owner_resume');
  elsif v_action in ('extend','forgive') then
    v_result:=atlas.record_rhythm_game_master_satisfaction_v1(
      v_state.id,
      coalesce(nullif(btrim(p_idempotency_key),''),'biological-control:'||v_action||':'||v_state.id::text||':'||extract(epoch from now())::bigint::text),
      p_reason,
      case when v_action='extend' then greatest(coalesce(p_extension_seconds,86400),3600) else null end,
      jsonb_build_object('controlAction',v_action,'biologicalClock',true)
    );
  else
    raise exception 'Unsupported biological rhythm control.' using errcode='22023';
  end if;
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object('action',v_action,'stateId',v_state.id);
end;
$$;

grant execute on function atlas.owner_control_biological_rhythm_v1(uuid,text,text,integer,text) to authenticated;
revoke all on function atlas.owner_control_biological_rhythm_v1(uuid,text,text,integer,text) from anon;

do $$
declare
  v_farm_id uuid;
  v_org_id uuid;
  v_anna_membership uuid;
  v_anna_user uuid;
  v_grow_object uuid;
  v_grow_rule uuid;
  v_grow_binding uuid;
  v_germ_rule uuid;
  v_stage text;
  v_last_round timestamptz;
  v_open_round uuid;
  v_cycle record;
begin
  select id,organization_id into v_farm_id,v_org_id from atlas.farms where stable_key='elm_farm';
  select id,user_id into v_anna_membership,v_anna_user from atlas.farm_memberships where farm_id=v_farm_id and worker_key='anna' and active order by created_at limit 1;
  select id into v_grow_object from atlas.growing_objects where farm_id=v_farm_id and stable_key='grow_room_seed_shelves';
  if v_farm_id is null or v_org_id is null or v_grow_object is null then raise exception 'Elm Farm biological Clock prerequisites are missing.'; end if;

  insert into atlas.rhythm_rules(organization_id,farm_id,rule_key,rhythm_key,version,label,status,applicability,validity_interval_seconds,warning_window_seconds,grace_window_seconds,qualifying_touches,failure_consequence,player_routing,activated_at,owner_reason,metadata)
  values(v_org_id,v_farm_id,'elm_grow_room_care_daily','grow_room_care',1,'Grow Room daily care rhythm','active',jsonb_build_object('subjectKind','growing_object','objectMode','seed_room'),86400,21600,43200,
    jsonb_build_array(jsonb_build_object('sourceKind','task','sourceEvent','done','taskType','grow_room_care','actionKey','grow_room_round','effect','full')),
    jsonb_build_object('dueTask',jsonb_build_object('title','Grow Room Care','taskType','grow_room_care','actionKey','grow_room_round','workClass','standard','visibilityScope','assigned_worker','assignedMembershipId',v_anna_membership,'priority','normal'),'failureTask',jsonb_build_object('title','Grow Room Care','taskType','grow_room_care','actionKey','grow_room_round','workClass','standard','visibilityScope','assigned_worker','assignedMembershipId',v_anna_membership,'priority','high')),
    jsonb_build_object('visibilityScope','assigned_worker','assignedMembershipId',v_anna_membership,'assignedUserId',v_anna_user),now(),'Owner approved Grow Room Clock enrollment',jsonb_build_object('timezoneName','America/Chicago','boundaryMode','exact_timestamp','timeClaimsPhysicalCondition',false,'domain','grow_room'))
  on conflict (farm_id,rule_key,version) do update set status='active',qualifying_touches=excluded.qualifying_touches,failure_consequence=excluded.failure_consequence,player_routing=excluded.player_routing,metadata=atlas.rhythm_rules.metadata||excluded.metadata,updated_at=now()
  returning id into v_grow_rule;

  insert into atlas.rhythm_bindings(organization_id,farm_id,rhythm_rule_id,binding_key,inheritance_layer,subject_kind,subject_id,priority,active,owner_reason,metadata)
  values(v_org_id,v_farm_id,v_grow_rule,'elm_grow_room_seed_shelves_care','subject_override','growing_object',v_grow_object,100,true,'Grow Room seed shelves own the care rhythm',jsonb_build_object('domain','grow_room'))
  on conflict (farm_id,binding_key) do update set rhythm_rule_id=excluded.rhythm_rule_id,active=true,updated_at=now()
  returning id into v_grow_binding;

  insert into atlas.rhythm_rules(organization_id,farm_id,rule_key,rhythm_key,version,label,status,applicability,validity_interval_seconds,warning_window_seconds,grace_window_seconds,qualifying_touches,failure_consequence,player_routing,activated_at,owner_reason,metadata)
  values(v_org_id,v_farm_id,'elm_germination_observation_daily','germination_watch',1,'Daily germination observation watch','active',jsonb_build_object('subjectKind','crop_cycle','requiresSownDate',true),86400,21600,86400,
    jsonb_build_array(jsonb_build_object('sourceKind','crop_cycle','sourceEvent','germination_observed:not_yet','effect','full','renewalIntervalSeconds',86400),jsonb_build_object('sourceKind','crop_cycle','sourceEvent','germination_observed:beginning','effect','full','renewalIntervalSeconds',86400),jsonb_build_object('sourceKind','crop_cycle','sourceEvent','germination_observed:germinated','effect','full'),jsonb_build_object('sourceKind','crop_cycle','sourceEvent','germination_observed:failed_or_uncertain','effect','partial'),jsonb_build_object('sourceKind','crop_cycle','sourceEvent','germination_observed:problem_found','effect','partial')),
    jsonb_build_object('dueTask',jsonb_build_object('title','Check germination','taskType','germination_check','actionKey','germination_check','workClass','crop_cycle','visibilityScope','assigned_worker','assignedMembershipId',v_anna_membership,'priority','normal'),'failureTask',jsonb_build_object('title','Check germination','taskType','germination_check','actionKey','germination_check','workClass','crop_cycle','visibilityScope','assigned_worker','assignedMembershipId',v_anna_membership,'priority','high')),
    jsonb_build_object('visibilityScope','assigned_worker','assignedMembershipId',v_anna_membership,'assignedUserId',v_anna_user),now(),'Owner approved biological germination watch',jsonb_build_object('timezoneName','America/Chicago','boundaryMode','exact_timestamp','timeClaimsPhysicalCondition',false,'domain','germination'))
  on conflict (farm_id,rule_key,version) do update set status='active',qualifying_touches=excluded.qualifying_touches,failure_consequence=excluded.failure_consequence,player_routing=excluded.player_routing,metadata=atlas.rhythm_rules.metadata||excluded.metadata,updated_at=now()
  returning id into v_germ_rule;

  foreach v_stage in array array['sown','germinating','germination_pending','emerging'] loop
    insert into atlas.rhythm_bindings(organization_id,farm_id,rhythm_rule_id,binding_key,inheritance_layer,subject_kind,subject_key,priority,active,owner_reason,metadata)
    values(v_org_id,v_farm_id,v_germ_rule,'elm_germination_stage_'||v_stage,'contents_stage','crop_stage',v_stage,50,true,'Observe sown crops until germination is resolved',jsonb_build_object('stage',v_stage,'domain','germination'))
    on conflict (farm_id,binding_key) do update set rhythm_rule_id=excluded.rhythm_rule_id,active=true,updated_at=now();
  end loop;

  insert into atlas.task_objects(task_id,object_id,role)
  select t.id,v_grow_object,'target' from atlas.tasks t
  where t.farm_id=v_farm_id and t.task_type='grow_room_care' and t.action_key='grow_room_round' and lower(btrim(t.title))='grow room care'
  on conflict do nothing;

  select max(we.created_at) into v_last_round from atlas.workflow_events we join atlas.tasks t on we.source_kind='task' and we.source_id=t.id
  where we.farm_id=v_farm_id and we.source_event='done' and t.task_type='grow_room_care' and t.action_key='grow_room_round';
  select t.id into v_open_round from atlas.tasks t where t.farm_id=v_farm_id and t.status in ('open','blocked') and t.task_type='grow_room_care' and t.action_key='grow_room_round' and lower(btrim(t.title))='grow room care' order by t.due_date nulls last,t.created_at limit 1;
  v_last_round:=coalesce(v_last_round,now()-interval '1 day');
  perform atlas.seed_biological_rhythm_state_v1(v_grow_binding,'growing_object',v_grow_object,v_last_round,v_open_round,(select planned_occurrence_id from atlas.tasks where id=v_open_round),'grow_room_round_completed',jsonb_build_object('lastRoundAt',v_last_round,'physicalConditionClaimed',false));

  for v_cycle in
    select distinct cc.id,(select t.id from atlas.tasks t join atlas.task_crop_cycles tcc on tcc.task_id=t.id where tcc.crop_cycle_id=cc.id and t.status in ('open','blocked') and (t.task_type='germination_check' or coalesce(t.metadata->>'task_style','')='germination_check') order by t.due_date nulls last,t.created_at limit 1) task_id
    from atlas.crop_cycles cc
    where cc.farm_id=v_farm_id and cc.lifecycle_status='active' and cc.sown_date is not null and cc.cycle_state in ('sown','germinating','germination_pending','emerging')
      and (cc.expected_germination_start is not null or exists(select 1 from atlas.task_crop_cycles tcc join atlas.tasks t on t.id=tcc.task_id where tcc.crop_cycle_id=cc.id and t.status in ('open','blocked') and (t.task_type='germination_check' or coalesce(t.metadata->>'task_style','')='germination_check')))
  loop
    perform atlas.enroll_germination_watch_v1(v_cycle.id,v_cycle.task_id);
  end loop;
end $$;

create index if not exists rhythm_state_biological_domains_idx on atlas.rhythm_state(farm_id,rhythm_key,state,due_at) where rhythm_key in ('grow_room_care','germination_watch');
create index if not exists crop_cycles_germination_clock_idx on atlas.crop_cycles(farm_id,cycle_state,expected_germination_start) where sown_date is not null and lifecycle_status='active';
