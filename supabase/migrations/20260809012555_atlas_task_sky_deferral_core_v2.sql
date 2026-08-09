alter table atlas.tasks add column if not exists sky_deferral_mode text not null default 'auto';
alter table atlas.tasks add column if not exists sky_deferral_class text;
alter table atlas.tasks add column if not exists sky_deferral_horizon_days integer;
alter table atlas.tasks add column if not exists sky_deferral_anchor_at timestamptz;
alter table atlas.tasks add column if not exists sky_deferral_reason text;
alter table atlas.tasks add column if not exists sky_deferral_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='tasks_sky_deferral_mode_check'
      and conrelid='atlas.tasks'::regclass
  ) then
    alter table atlas.tasks add constraint tasks_sky_deferral_mode_check
      check (sky_deferral_mode in ('auto','allow','never'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='tasks_sky_deferral_class_check'
      and conrelid='atlas.tasks'::regclass
  ) then
    alter table atlas.tasks add constraint tasks_sky_deferral_class_check
      check (sky_deferral_class is null or sky_deferral_class in ('none','short','medium','long'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='tasks_sky_deferral_horizon_days_check'
      and conrelid='atlas.tasks'::regclass
  ) then
    alter table atlas.tasks add constraint tasks_sky_deferral_horizon_days_check
      check (sky_deferral_horizon_days is null or sky_deferral_horizon_days between 1 and 120);
  end if;
end $$;

comment on column atlas.tasks.sky_deferral_mode is
'Owner/task policy: auto derives from farm truth, allow opts an otherwise safe task into sky deferral, never prevents sky withholding. Safety protections still outrank allow.';
comment on column atlas.tasks.sky_deferral_class is
'Optional explicit sky deferral class: none, short, medium, or long. Null means derive automatically.';
comment on column atlas.tasks.sky_deferral_horizon_days is
'Maximum cumulative time Atlas may wait on sky timing before the task fails open and remains actionable.';
comment on column atlas.tasks.sky_deferral_anchor_at is
'Anchor for the cumulative sky-deferral horizon. Explicitly governed work starts its waiting clock when governance is adopted.';
comment on column atlas.tasks.sky_deferral_reason is
'Human-readable reason for an explicit deferral policy.';
comment on column atlas.tasks.sky_deferral_source is
'Provenance for explicit sky-deferral policy, e.g. owner_policy or migration.';

update atlas.tasks
set sky_deferral_mode='allow',
    sky_deferral_class='long',
    sky_deferral_horizon_days=30,
    sky_deferral_anchor_at=coalesce(sky_deferral_anchor_at,now()),
    sky_deferral_reason=coalesce(
      sky_deferral_reason,
      metadata->>'sky_deferral_reason',
      'Perennial iris division is next-year landscape work with no current-season biological deadline; Owner permits waiting for a favored sky interval.'
    ),
    sky_deferral_source=coalesce(sky_deferral_source,'owner_policy')
where metadata->>'task_key'='anna_20260716_divide_lilac_haven_irises_into_drifts';

create or replace function atlas.task_sky_deferral_policy_v2(
  p_task_id uuid,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_at timestamptz := coalesce(p_at,now());
  v_mode text;
  v_explicit_class text;
  v_class text := 'none';
  v_horizon integer;
  v_anchor timestamptz;
  v_deadline timestamptz;
  v_schedule_semantics text;
  v_has_crop_link boolean := false;
  v_has_dependency boolean := false;
  v_has_live_occurrence_timing boolean := false;
  v_occurrence_state text;
  v_occurrence_due date;
  v_occurrence_not_before date;
  v_policy_allows boolean := false;
  v_can boolean := false;
  v_reason text;
  v_source text := 'derived';
  v_signals jsonb := '[]'::jsonb;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_task.farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  v_mode := lower(coalesce(nullif(v_task.sky_deferral_mode,''),'auto'));
  v_explicit_class := lower(coalesce(nullif(v_task.sky_deferral_class,''),''));
  v_schedule_semantics := lower(coalesce(nullif(v_task.metadata->>'schedule_semantics',''),''));

  select exists(select 1 from atlas.task_crop_cycles link where link.task_id=v_task.id)
    into v_has_crop_link;

  select exists(
    select 1
    from atlas.task_dependency_clocks clock
    where (clock.source_task_id=v_task.id or clock.downstream_task_id=v_task.id)
      and coalesce(clock.state,'') <> 'completed'
  ) into v_has_dependency;

  if v_task.planned_occurrence_id is not null then
    select occurrence.state, occurrence.planned_due_date, occurrence.not_before_date,
           occurrence.state in ('planned','eligible')
             and (occurrence.planned_due_date is not null or occurrence.not_before_date is not null)
    into v_occurrence_state,v_occurrence_due,v_occurrence_not_before,v_has_live_occurrence_timing
    from atlas.planned_work_occurrences occurrence
    where occurrence.id=v_task.planned_occurrence_id;
  end if;

  if coalesce(v_task.metadata->>'sky_timing_mode','') in ('ignore','off','disabled') then
    v_reason := 'task_sky_timing_disabled';
    v_signals := v_signals || jsonb_build_array('sky_timing_disabled');
  elsif v_task.status <> 'open' then
    v_reason := 'task_not_open';
    v_signals := v_signals || jsonb_build_array('task_not_open');
  elsif v_task.priority='urgent' then
    v_reason := 'urgent_farm_priority_protected';
    v_signals := v_signals || jsonb_build_array('urgent_priority');
  elsif v_task.commitment_kind is distinct from 'floating' then
    v_reason := 'commitment_not_floating';
    v_signals := v_signals || jsonb_build_array('non_floating_commitment');
  elsif v_task.due_date is not null then
    v_reason := 'dated_or_biologically_timed';
    v_signals := v_signals || jsonb_build_array('live_due_date');
  elsif v_task.work_lane in ('process_continuation','rhythm') then
    v_reason := 'workflow_or_heartbeat_protected';
    v_signals := v_signals || jsonb_build_array(v_task.work_lane);
  elsif v_has_crop_link then
    v_reason := 'living_crop_timing_protected';
    v_signals := v_signals || jsonb_build_array('crop_cycle_link');
  elsif v_has_dependency then
    v_reason := 'dependency_chain_protected';
    v_signals := v_signals || jsonb_build_array('active_dependency_clock');
  elsif v_has_live_occurrence_timing then
    v_reason := 'live_occurrence_timing_protected';
    v_signals := v_signals || jsonb_build_array('planned_or_eligible_occurrence_date');
  elsif v_mode='never' or v_explicit_class='none' then
    v_reason := 'explicitly_protected_from_sky_deferral';
    v_source := coalesce(nullif(v_task.sky_deferral_source,''),'task_policy');
    v_signals := v_signals || jsonb_build_array('explicit_never');
  elsif v_mode='allow' or v_explicit_class in ('short','medium','long') then
    v_policy_allows := true;
    v_class := case when v_explicit_class in ('short','medium','long') then v_explicit_class else 'long' end;
    v_reason := 'explicit_task_deferral_policy';
    v_source := coalesce(nullif(v_task.sky_deferral_source,''),'task_policy');
    v_signals := v_signals || jsonb_build_array('explicit_allow');
  elsif v_schedule_semantics='floating_eligibility' and v_task.work_lane='discretionary' then
    v_policy_allows := true;
    v_class := 'long';
    v_reason := 'derived_floating_eligibility_long_horizon';
    v_source := 'derived_schedule_semantics';
    v_signals := v_signals || jsonb_build_array('floating_eligibility','discretionary_lane');
  else
    v_reason := 'no_positive_long_horizon_signal';
    v_signals := v_signals || jsonb_build_array('deferrability_unproven');
  end if;

  if v_policy_allows then
    begin
      v_horizon := coalesce(
        v_task.sky_deferral_horizon_days,
        nullif(v_task.metadata->>'sky_deferral_horizon_days','')::integer,
        case v_class when 'short' then 2 when 'medium' then 7 else 30 end
      );
    exception when others then
      v_horizon := case v_class when 'short' then 2 when 'medium' then 7 else 30 end;
    end;
    v_horizon := greatest(1,least(v_horizon,120));

    v_anchor := coalesce(
      v_task.sky_deferral_anchor_at,
      case when v_mode='allow' or v_explicit_class in ('short','medium','long') then v_task.updated_at end,
      v_task.released_at,
      v_task.created_at,
      v_at
    );
    v_deadline := v_anchor + make_interval(days=>v_horizon);

    if v_at >= v_deadline then
      v_can := false;
      v_reason := 'deferral_horizon_expired';
      v_signals := v_signals || jsonb_build_array('cumulative_wait_limit_reached');
    else
      v_can := true;
    end if;
  else
    v_class := 'none';
    v_horizon := null;
    v_anchor := null;
    v_deadline := null;
  end if;

  return jsonb_build_object(
    'contractVersion','task_sky_deferral_policy_v2',
    'taskId',v_task.id,
    'canSkyWithhold',v_can,
    'policyAllowsSkyDeferral',v_policy_allows,
    'reason',v_reason,
    'deferralClass',v_class,
    'maxDeferralDays',v_horizon,
    'deferralAnchorAt',v_anchor,
    'deferralDeadlineAt',v_deadline,
    'policyMode',v_mode,
    'policySource',v_source,
    'policyReason',v_task.sky_deferral_reason,
    'dueDate',v_task.due_date,
    'commitmentKind',v_task.commitment_kind,
    'workLane',v_task.work_lane,
    'scheduleSemantics',nullif(v_schedule_semantics,''),
    'hasCropCycleLink',v_has_crop_link,
    'hasActiveDependency',v_has_dependency,
    'occurrenceState',v_occurrence_state,
    'occurrencePlannedDueDate',v_occurrence_due,
    'occurrenceNotBeforeDate',v_occurrence_not_before,
    'signals',v_signals
  );
end;
$$;

revoke all on function atlas.task_sky_deferral_policy_v2(uuid,timestamptz) from public, anon, authenticated;
grant execute on function atlas.task_sky_deferral_policy_v2(uuid,timestamptz) to service_role;

create or replace function atlas.task_sky_presentation_gate_v1(
  p_task_id uuid,
  p_work_date date default null::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_timezone text := 'America/Chicago';
  v_day date;
  v_today date;
  v_at timestamptz;
  v_fitness jsonb;
  v_policy jsonb;
  v_withheld boolean := false;
  v_next timestamptz;
  v_deadline timestamptz;
  v_horizon_ok boolean := false;
  v_nonwithhold_reason text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone from atlas.farms f where f.id=v_task.farm_id;
  v_day := coalesce(p_work_date,(now() at time zone v_timezone)::date);
  v_today := (now() at time zone v_timezone)::date;
  v_at := case when v_day=v_today then now() else (v_day::timestamp + time '12:00') at time zone v_timezone end;

  v_fitness := atlas.task_sky_fitness_v2(v_task.id,v_at);
  v_policy := atlas.task_sky_deferral_policy_v2(v_task.id,v_at);

  begin
    v_next := nullif(v_fitness->>'favoredWindowStart','')::timestamptz;
  exception when others then
    v_next := null;
  end;
  begin
    v_deadline := nullif(v_policy->>'deferralDeadlineAt','')::timestamptz;
  exception when others then
    v_deadline := null;
  end;

  v_horizon_ok := coalesce((v_policy->>'canSkyWithhold')::boolean,false)
    and v_next is not null
    and (v_deadline is null or v_next <= v_deadline);

  v_withheld := coalesce((v_policy->>'canSkyWithhold')::boolean,false)
    and coalesce(v_fitness->>'enforcementMode','informative')='windowed'
    and coalesce((v_fitness->>'eligibleUnderSky')::boolean,true)=false
    and v_horizon_ok;

  if not v_withheld
     and coalesce(v_fitness->>'enforcementMode','informative')='windowed'
     and coalesce((v_fitness->>'eligibleUnderSky')::boolean,true)=false then
    if not coalesce((v_policy->>'canSkyWithhold')::boolean,false) then
      v_nonwithhold_reason := coalesce(v_policy->>'reason','sky_deferral_not_authorized');
    elsif v_next is null then
      v_nonwithhold_reason := 'next_favored_window_unknown_fail_open';
    elsif v_deadline is not null and v_next > v_deadline then
      v_nonwithhold_reason := 'next_favored_window_beyond_cumulative_deferral_deadline';
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','task_sky_presentation_gate_v3',
    'taskId',v_task.id,
    'workDate',v_day,
    'evaluatedAt',v_at,
    'withheldUnderSky',v_withheld,
    'presentationReason',case when v_withheld then 'awaiting_favored_sky_window' else null end,
    'nonWithholdReason',v_nonwithhold_reason,
    'nextEligibleAt',v_fitness->>'favoredWindowStart',
    'nextEligibleUntil',v_fitness->>'favoredWindowEnd',
    'deferralDeadlineAt',v_policy->>'deferralDeadlineAt',
    'deferralPolicy',v_policy,
    'fitness',v_fitness
  );
end;
$$;

comment on function atlas.task_sky_presentation_gate_v1(uuid,date) is
'Sky withholding requires two independent permissions: a Windowed operation rule and a currently safe task-deferral policy. Farm urgency, live dates, crop-cycle timing, process/rhythm lanes, dependency clocks, and cumulative deferral expiry all revoke permission to wait.';
