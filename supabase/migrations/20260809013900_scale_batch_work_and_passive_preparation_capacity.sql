-- Consolidating multiple tray tasks into one parent must not collapse their labor estimate to one tray.
-- Passive charger time is elapsed time, not active paid labor.

insert into atlas.task_capacity_profiles (
  task_id, farm_id, expected_active_minutes, physical_load, base_obligation_class, micro_round_key,
  estimate_source, estimate_confidence, owner_locked, owner_note, metadata, updated_at
)
select
  t.id, t.farm_id, 5, 'light', 'optional_improvement', null,
  'owner_calibrated:charge_mower_batteries', 'owner_confirmed', true,
  'Plugging mower batteries into chargers is a small active preparation step; passive charging time is not paid active-work capacity.',
  jsonb_build_object('calibrated_by', 'owner_instruction_20260808', 'passive_elapsed_time_noncounting', true), now()
from atlas.tasks t
join atlas.farm_memberships fm on fm.id = t.assigned_membership_id
join atlas.farms f on f.id = t.farm_id
where f.stable_key = 'elm_farm'
  and fm.worker_key = 'anna'
  and t.title = 'Charge DeWalt Batteries for Mowing'
on conflict (task_id) do update
set expected_active_minutes = excluded.expected_active_minutes,
    physical_load = excluded.physical_load,
    base_obligation_class = excluded.base_obligation_class,
    micro_round_key = excluded.micro_round_key,
    estimate_source = excluded.estimate_source,
    estimate_confidence = excluded.estimate_confidence,
    owner_locked = excluded.owner_locked,
    owner_note = excluded.owner_note,
    metadata = coalesce(atlas.task_capacity_profiles.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

create or replace function atlas.task_capacity_plan_v1(
  p_task atlas.tasks,
  p_work_date date default null::date
)
returns table(
  expected_active_minutes integer,
  physical_load text,
  base_obligation_class text,
  effective_obligation_class text,
  micro_round_key text,
  estimate_source text,
  estimate_confidence text,
  recovery_origin_due_date date
)
language plpgsql stable security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_work_date date := coalesce(p_work_date, (now() at time zone 'America/Chicago')::date);
  v_profile atlas.task_capacity_profiles%rowtype;
  v_default record;
  v_effective text;
  v_sky_gate jsonb;
  v_personal boolean := false;
  v_batch_count integer := 1;
  v_scale_batch boolean := false;
begin
  v_batch_count := greatest(coalesce(nullif(p_task.metadata ->> 'batch_item_count', '')::integer, 1), 1);

  select profile.* into v_profile
  from atlas.task_capacity_profiles profile
  where profile.task_id = p_task.id;

  if v_profile.task_id is null then
    select * into v_default from atlas.task_capacity_default_v1(p_task);
    expected_active_minutes := v_default.expected_active_minutes;
    physical_load := v_default.physical_load;
    base_obligation_class := v_default.base_obligation_class;
    micro_round_key := v_default.micro_round_key;
    estimate_source := v_default.estimate_source;
    estimate_confidence := v_default.estimate_confidence;
    recovery_origin_due_date := null;
    v_scale_batch := coalesce(estimate_source, '') like 'rule:%';
  else
    expected_active_minutes := v_profile.expected_active_minutes;
    physical_load := v_profile.physical_load;
    base_obligation_class := v_profile.base_obligation_class;
    micro_round_key := v_profile.micro_round_key;
    estimate_source := v_profile.estimate_source;
    estimate_confidence := v_profile.estimate_confidence;
    recovery_origin_due_date := v_profile.recovery_origin_due_date;
    v_scale_batch := coalesce(v_profile.owner_locked, false) = false
      and coalesce(estimate_source, '') like 'rule:%';
  end if;

  if lower(coalesce(p_task.metadata ->> 'task_work_shape', '')) = 'batch'
     and v_batch_count > 1
     and v_scale_batch then
    expected_active_minutes := expected_active_minutes * v_batch_count;
    estimate_source := estimate_source || '+batch_x' || v_batch_count::text;
  end if;

  v_effective := base_obligation_class;
  if p_task.status in ('open', 'blocked') and p_task.due_date is not null and p_task.due_date < v_work_date then
    v_effective := 'recovery_work';
    recovery_origin_due_date := coalesce(recovery_origin_due_date, p_task.due_date);
  elsif p_task.commitment_kind = 'hard_date' and p_task.due_date is not distinct from v_work_date then
    v_effective := 'hard_window';
  end if;

  if p_task.status = 'open' and p_task.commitment_kind = 'floating' and p_task.due_date is null then
    v_sky_gate := atlas.task_sky_presentation_gate_v1(p_task.id, v_work_date);
    if coalesce((v_sky_gate ->> 'withheldUnderSky')::boolean, false) then
      expected_active_minutes := 0;
      estimate_source := coalesce(estimate_source, 'capacity') || '+sky_withheld';
    end if;
  end if;

  v_personal := coalesce((p_task.metadata ->> 'personal_task')::boolean, false)
    or lower(coalesce(p_task.metadata ->> 'paid_work', 'true')) in ('false', 'no', '0');

  if v_personal then
    expected_active_minutes := 0;
    physical_load := 'light';
    estimate_source := 'personal_noncounting';
    estimate_confidence := 'owner_confirmed';
  elsif micro_round_key = 'grow_room_observation' then
    expected_active_minutes := 0;
    physical_load := 'light';
    estimate_source := coalesce(estimate_source, 'capacity') || '+micro_observation_noncounting';
  end if;

  effective_obligation_class := v_effective;
  return next;
end;
$function$;
