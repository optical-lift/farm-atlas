do $$
declare
  v_task atlas.tasks%rowtype;
  v_plan atlas.production_plans%rowtype;
  v_primary_cycle uuid;
  v_cycle_ids jsonb;
  v_bed_labels jsonb;
begin
  select * into strict v_task
  from atlas.tasks
  where metadata->>'task_key' = 'anna_20260817_sow_procut_orange_fr11_fr12_after_turnover';

  select * into strict v_plan
  from atlas.production_plans
  where stable_key = 'pollenless_sunflowers_2026'
    and season_year = 2026;

  select crop_cycle_id into strict v_primary_cycle
  from atlas.v_planned_crop_cycles_by_object
  where source_task_id = v_task.id
    and object_key = 'fr_11';

  select
    jsonb_agg(crop_cycle_id order by object_key),
    jsonb_agg(upper(replace(object_key, '_', '')) order by object_key)
  into v_cycle_ids, v_bed_labels
  from atlas.v_planned_crop_cycles_by_object
  where source_task_id = v_task.id
    and object_key in ('fr_11', 'fr_12');

  if jsonb_array_length(coalesce(v_cycle_ids, '[]'::jsonb)) <> 2 then
    raise exception 'FR11/FR12 planned crop-cycle pair was not found';
  end if;

  update atlas.production_successions ps
  set
    planned_window_start = v_task.due_date,
    planned_window_end = v_task.due_date,
    late_window_end = v_task.due_date + make_interval(days => coalesce(v_plan.late_window_days, 5)),
    skip_after_date = coalesce((v_task.metadata->>'latest_safe_sow_date')::date, v_task.due_date),
    actual_sow_date = null,
    projected_germination_start = (v_task.metadata->>'projected_germination_start')::date,
    projected_germination_end = (v_task.metadata->>'projected_germination_end')::date,
    projected_harvest_start = (v_task.metadata->>'projected_harvest_start')::date,
    projected_harvest_end = (v_task.metadata->>'projected_harvest_end')::date,
    projected_clear_date = (v_task.metadata->>'projected_clear_bed_date')::date,
    state = 'in_window',
    crop_cycle_id = v_primary_cycle,
    sow_task_id = v_task.id,
    skip_reason = null,
    metadata = jsonb_build_object(
      'task_ids', jsonb_build_array(v_task.id),
      'varieties', jsonb_build_array(v_task.metadata->>'variety'),
      'bed_labels', v_bed_labels,
      'crop_cycle_ids', v_cycle_ids,
      'planned_succession', true,
      'reconciled_at', now(),
      'reconciliation_source', 'owner_current_fr11_fr12_sow_truth_20260821',
      'prior_metadata', ps.metadata
    ),
    updated_at = now()
  where ps.production_plan_id = v_plan.id
    and ps.sequence_number = 11;

  if not found then
    raise exception 'Pollenless sunflower succession 11 slot was not found';
  end if;
end $$;
