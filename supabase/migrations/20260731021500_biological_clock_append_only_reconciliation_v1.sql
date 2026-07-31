-- Reconcile biological baselines without mutating append-only satisfaction history.

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
  v_satisfaction_key text;
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

  v_satisfaction_key := 'biological-baseline:'||v_state_id::text||':'||extract(epoch from p_anchor_at)::bigint::text;
  insert into atlas.rhythm_satisfactions(
    organization_id,farm_id,rhythm_state_id,rhythm_binding_id,rhythm_rule_id,
    rhythm_key,subject_kind,subject_id,satisfaction_key,satisfaction_kind,
    satisfied_at,renewal_interval_seconds,source_kind,source_id,source_event,
    policy_match,evidence
  ) values (
    v_binding.organization_id,v_binding.farm_id,v_state_id,v_binding.id,v_rule.id,
    v_rule.rhythm_key,p_subject_kind,p_subject_id,v_satisfaction_key,
    'conditional',p_anchor_at,v_rule.validity_interval_seconds,
    'biological_clock',p_subject_id,p_source_event,
    jsonb_build_object('enrollment',true,'physicalConditionClaimed',false),
    jsonb_build_object('anchorAt',p_anchor_at,'metadata',coalesce(p_metadata,'{}'::jsonb))
  ) on conflict (farm_id,satisfaction_key) do nothing
  returning id into v_satisfaction_id;

  if v_satisfaction_id is null then
    select id into v_satisfaction_id from atlas.rhythm_satisfactions
    where farm_id=v_binding.farm_id and satisfaction_key=v_satisfaction_key;
  end if;

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
  v_profile_min_days integer;
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

  select greatest(coalesce(cp.days_to_germination_min,3),1)
  into v_profile_min_days
  from atlas.crop_profiles cp
  where cp.id=v_cycle.crop_profile_id;
  v_profile_min_days:=coalesce(v_profile_min_days,3);

  v_due_date:=coalesce(
    v_task.due_date,
    case when v_cycle.expected_germination_start is not null and v_cycle.expected_germination_start>=v_cycle.sown_date then v_cycle.expected_germination_start end,
    v_cycle.sown_date+v_profile_min_days
  );
  v_due_at := make_timestamptz(extract(year from v_due_date)::int,extract(month from v_due_date)::int,extract(day from v_due_date)::int,8,0,0,'America/Chicago');
  v_anchor_at := v_due_at - make_interval(secs=>v_rule.validity_interval_seconds);
  v_state_id := atlas.seed_biological_rhythm_state_v1(v_binding.id,'crop_cycle',v_cycle.id,v_anchor_at,v_task.id,v_task.planned_occurrence_id,'germination_window_open',jsonb_build_object('dueDate',v_due_date,'cycleState',v_cycle.cycle_state,'physicalConditionClaimed',false,'projectionReconciled',true));

  if v_task.id is not null then
    update atlas.tasks set action_key='germination_check',work_class='crop_cycle',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('rhythm_state_id',v_state_id,'rhythm_key','germination_watch','clock_managed',true),updated_at=now()
    where id=v_task.id;
  end if;
  return jsonb_build_object('enrolled',true,'stateId',v_state_id,'taskId',v_task.id,'dueDate',v_due_date);
end;
$$;

revoke all on function atlas.enroll_germination_watch_v1(uuid,uuid) from public,anon,authenticated;

do $$
declare v_cycle record;
begin
  for v_cycle in
    select rs.subject_id as cycle_id,rs.current_task_id as task_id
    from atlas.rhythm_state rs
    where rs.rhythm_key='germination_watch' and rs.subject_kind='crop_cycle'
  loop
    perform atlas.enroll_germination_watch_v1(v_cycle.cycle_id,v_cycle.task_id);
  end loop;
end $$;
