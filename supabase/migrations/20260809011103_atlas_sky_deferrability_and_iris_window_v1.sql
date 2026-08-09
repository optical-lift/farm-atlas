create or replace function atlas.task_sky_deferral_policy_v1(
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
  v_class text;
  v_schedule_semantics text;
  v_max_days integer;
  v_can boolean := false;
  v_reason text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_task.farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  v_class := lower(coalesce(nullif(v_task.metadata->>'sky_deferral_class',''),''));
  v_schedule_semantics := lower(coalesce(nullif(v_task.metadata->>'schedule_semantics',''),''));
  begin
    v_max_days := greatest(1,least(coalesce((v_task.metadata->>'sky_deferral_horizon_days')::integer,30),120));
  exception when others then
    v_max_days := 30;
  end;

  if coalesce(v_task.metadata->>'sky_timing_mode','') in ('ignore','off','disabled') then
    v_reason := 'task_sky_timing_disabled';
  elsif v_task.status <> 'open' then
    v_reason := 'task_not_open';
  elsif v_task.commitment_kind is distinct from 'floating' then
    v_reason := 'commitment_not_floating';
  elsif v_task.due_date is not null then
    v_reason := 'dated_or_biologically_timed';
  elsif v_task.work_lane = 'process_continuation' then
    v_reason := 'process_continuation_protected';
  elsif v_class in ('never','protected','biological','time_bounded') then
    v_reason := 'explicitly_protected_from_sky_deferral';
  elsif v_class in ('long_horizon','anytime','discretionary') then
    v_can := true;
    v_reason := 'explicit_long_horizon_deferrable';
  elsif v_schedule_semantics = 'floating_eligibility' and v_task.work_lane = 'discretionary' then
    v_can := true;
    v_reason := 'floating_eligibility_long_horizon';
  else
    v_reason := 'no_long_horizon_deferral_authority';
  end if;

  return jsonb_build_object(
    'contractVersion','task_sky_deferral_policy_v1',
    'taskId',v_task.id,
    'canSkyWithhold',v_can,
    'reason',v_reason,
    'deferralClass',nullif(v_class,''),
    'maxDeferralDays',v_max_days,
    'dueDate',v_task.due_date,
    'commitmentKind',v_task.commitment_kind,
    'workLane',v_task.work_lane,
    'scheduleSemantics',nullif(v_schedule_semantics,'')
  );
end;
$$;

revoke all on function atlas.task_sky_deferral_policy_v1(uuid,timestamptz) from public;
grant execute on function atlas.task_sky_deferral_policy_v1(uuid,timestamptz) to authenticated, service_role;

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
  v_max_days integer := 30;
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
  v_policy := atlas.task_sky_deferral_policy_v1(v_task.id,v_at);
  begin
    v_max_days := coalesce((v_policy->>'maxDeferralDays')::integer,30);
  exception when others then
    v_max_days := 30;
  end;
  begin
    v_next := nullif(v_fitness->>'favoredWindowStart','')::timestamptz;
  exception when others then
    v_next := null;
  end;

  v_horizon_ok := v_next is not null and v_next <= v_at + make_interval(days=>v_max_days);

  v_withheld := coalesce((v_policy->>'canSkyWithhold')::boolean,false)
    and coalesce(v_fitness->>'enforcementMode','informative')='windowed'
    and coalesce((v_fitness->>'eligibleUnderSky')::boolean,true)=false
    and v_horizon_ok;

  if not v_withheld and coalesce(v_fitness->>'enforcementMode','informative')='windowed'
     and coalesce((v_fitness->>'eligibleUnderSky')::boolean,true)=false then
    if not coalesce((v_policy->>'canSkyWithhold')::boolean,false) then
      v_nonwithhold_reason := coalesce(v_policy->>'reason','sky_deferral_not_authorized');
    elsif v_next is null then
      v_nonwithhold_reason := 'next_favored_window_unknown_fail_open';
    elsif not v_horizon_ok then
      v_nonwithhold_reason := 'next_favored_window_beyond_safe_deferral_horizon';
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','task_sky_presentation_gate_v2',
    'taskId',v_task.id,
    'workDate',v_day,
    'evaluatedAt',v_at,
    'withheldUnderSky',v_withheld,
    'presentationReason',case when v_withheld then 'awaiting_favored_sky_window' else null end,
    'nonWithholdReason',v_nonwithhold_reason,
    'nextEligibleAt',v_fitness->>'favoredWindowStart',
    'nextEligibleUntil',v_fitness->>'favoredWindowEnd',
    'deferralPolicy',v_policy,
    'fitness',v_fitness
  );
end;
$$;

comment on function atlas.task_sky_presentation_gate_v1(uuid,date) is
'Sky may withhold only genuinely long-horizon floating work. Dated, dependency/process, biological, or otherwise non-deferrable work fails open. Even long-horizon work fails open when the next favored interval is unknown or beyond its safe deferral horizon.';

update atlas.tasks
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
  'sky_deferral_class','long_horizon',
  'sky_deferral_horizon_days',30,
  'sky_deferral_reason','Perennial iris division is next-year landscape work with no current-season biological deadline; Owner permits waiting for a favored sky interval.'
)
where metadata->>'task_key'='anna_20260716_divide_lilac_haven_irises_into_drifts';

update atlas.sky_operation_rules r
set active=false,
    status=case when status='approved' then 'retired' else status end,
    updated_at=now(),
    owner_note=coalesce(owner_note,'') || case when coalesce(owner_note,'')='' then '' else E'\n' end || 'Superseded by long-horizon-only Windowed governance. Preferred mode did not satisfy Owner intent for deferrable work.'
where r.stable_key='elm_divide_reestablish_common_mode_preference_v1' and r.active;

insert into atlas.sky_operation_rules(
  farm_id,stable_key,operation_class,rule_version,status,enforcement_mode,predicate,
  fitness_when_match,fitness_when_no_match,evidence_class,source_summary,source_refs,
  priority,active,valid_from,owner_note,metadata
)
select
  f.id,
  'elm_divide_reestablish_common_mode_window_v1',
  'divide_reestablish_belowground',
  1,
  'approved',
  'windowed',
  jsonb_build_object('moon_mode_in',jsonb_build_array('common')),
  'favored',
  'unfavored',
  'owner_operating_hypothesis',
  'The favored-state mapping is a working reconstruction: common/bicorporeal mode historically fits transition, duplication, repetition, return, and second-phase/non-final work. Owner policy adds the operational boundary: this mapping may actually withhold a task only when Atlas independently classifies that task as long-horizon deferrable. Biological timing, hard commitments, dependencies, and dated work outrank sky preference.',
  jsonb_build_array(
    jsonb_build_object('noel_term','zodiac_common_mode'),
    jsonb_build_object('noel_trail','Sacred Time / Stars / Priesthood / Astronomy'),
    jsonb_build_object('atlas_policy','task_sky_deferral_policy_v1')
  ),
  5,
  true,
  (now() at time zone coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago'))::date,
  'Owner policy: if a task can genuinely wait, hide it outside favored sky windows and return the same task later. Do not use sky to delay biologically timed work such as mature seedlings that need planting.',
  jsonb_build_object(
    'enforcement_scope','long_horizon_deferrable_only',
    'owner_policy','sky_can_wait_only_when_farm_can_wait',
    'window_formula_status','working_reconstruction_not_agronomic_fact',
    'created_from','owner_clarification_2026_08_08'
  )
from atlas.farms f
where exists(
  select 1 from atlas.sky_operation_rules prior
  where prior.farm_id=f.id and prior.stable_key='elm_iris_division_window_v1'
)
and not exists(
  select 1 from atlas.sky_operation_rules existing
  where existing.farm_id=f.id and existing.stable_key='elm_divide_reestablish_common_mode_window_v1' and existing.rule_version=1
);
