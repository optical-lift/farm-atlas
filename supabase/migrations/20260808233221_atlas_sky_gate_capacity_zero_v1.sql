create or replace function atlas.task_capacity_plan_v1(p_task atlas.tasks, p_work_date date default null::date)
returns table(expected_active_minutes integer, physical_load text, base_obligation_class text, effective_obligation_class text, micro_round_key text, estimate_source text, estimate_confidence text, recovery_origin_due_date date)
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_work_date date := coalesce(p_work_date,(now() at time zone 'America/Chicago')::date);
  v_profile atlas.task_capacity_profiles%rowtype;
  v_default record;
  v_effective text;
  v_sky_gate jsonb;
begin
  select profile.* into v_profile
  from atlas.task_capacity_profiles profile
  where profile.task_id=p_task.id;

  if v_profile.task_id is null then
    select * into v_default from atlas.task_capacity_default_v1(p_task);
    expected_active_minutes := v_default.expected_active_minutes;
    physical_load := v_default.physical_load;
    base_obligation_class := v_default.base_obligation_class;
    micro_round_key := v_default.micro_round_key;
    estimate_source := v_default.estimate_source;
    estimate_confidence := v_default.estimate_confidence;
    recovery_origin_due_date := null;
  else
    expected_active_minutes := v_profile.expected_active_minutes;
    physical_load := v_profile.physical_load;
    base_obligation_class := v_profile.base_obligation_class;
    micro_round_key := v_profile.micro_round_key;
    estimate_source := v_profile.estimate_source;
    estimate_confidence := v_profile.estimate_confidence;
    recovery_origin_due_date := v_profile.recovery_origin_due_date;
  end if;

  v_effective := base_obligation_class;
  if p_task.status in ('open','blocked') and p_task.due_date is not null and p_task.due_date<v_work_date then
    v_effective := 'recovery_work';
    recovery_origin_due_date := coalesce(recovery_origin_due_date,p_task.due_date);
  elsif p_task.commitment_kind='hard_date' and p_task.due_date is not distinct from v_work_date then
    v_effective := 'hard_window';
  end if;

  if p_task.status='open' and p_task.commitment_kind='floating' and p_task.due_date is null then
    v_sky_gate := atlas.task_sky_presentation_gate_v1(p_task.id,v_work_date);
    if coalesce((v_sky_gate->>'withheldUnderSky')::boolean,false) then
      expected_active_minutes := 0;
      estimate_source := coalesce(estimate_source,'capacity') || '+sky_withheld';
    end if;
  end if;

  effective_obligation_class := v_effective;
  return next;
end;
$$;
