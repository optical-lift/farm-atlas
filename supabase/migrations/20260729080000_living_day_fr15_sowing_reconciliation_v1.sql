-- Build 5: reconcile FR15 ProCut Horizon from the existing completed sowing result.
-- This does not create work or infer germination. It connects the named planned crop
-- cycle to the canonical completed task and lets the existing crop-cycle workflow
-- adapter write the Journal event.

do $$
declare
  v_farm_id uuid;
  v_object_id uuid;
  v_task_id uuid;
  v_cycle_id uuid;
  v_sown_date date;
  v_completed_at timestamptz;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key = 'elm_farm';

  if v_farm_id is null then
    return;
  end if;

  select id into v_object_id
  from atlas.growing_objects
  where farm_id = v_farm_id
    and stable_key = 'fr_15';

  select id, coalesce(due_date, completed_at::date), completed_at
  into v_task_id, v_sown_date, v_completed_at
  from atlas.tasks
  where farm_id = v_farm_id
    and metadata ->> 'task_key' = 'anna_20260724_sow_procut_horizon_fr15'
    and status = 'done'
  order by completed_at desc nulls last, created_at desc
  limit 1;

  select id into v_cycle_id
  from atlas.crop_cycles
  where farm_id = v_farm_id
    and object_id = v_object_id
    and crop_cycle_key = 'planned_fr15_procut_horizon_20260724'
  limit 1;

  if v_object_id is null or v_task_id is null or v_cycle_id is null or v_sown_date is null then
    return;
  end if;

  update atlas.crop_cycles
  set source_task_id = v_task_id,
      lifecycle_status = 'active',
      cycle_state = 'sown',
      sown_date = coalesce(sown_date, v_sown_date),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'activated_from_task', v_task_id,
        'activated_at', coalesce(v_completed_at, now()),
        'sowing_evidence_source', 'completed_task_result',
        'sowing_evidence_reconciled', true,
        'sowing_evidence_reconciled_by', 'living_day_v1',
        'uses_migration_time_as_sowing_date', false
      ),
      updated_at = now()
  where id = v_cycle_id
    and (
      source_task_id is distinct from v_task_id
      or lifecycle_status is distinct from 'active'
      or cycle_state is distinct from 'sown'
      or sown_date is null
    );

  insert into atlas.task_crop_cycles(task_id, crop_cycle_id, role, confidence, metadata)
  values (
    v_task_id,
    v_cycle_id,
    'creates',
    'confirmed',
    jsonb_build_object(
      'source', 'living_day_fr15_sowing_reconciliation_v1',
      'canonical_evidence', 'completed_task_result'
    )
  )
  on conflict (task_id, crop_cycle_id, role) do update
    set confidence = excluded.confidence,
        metadata = coalesce(atlas.task_crop_cycles.metadata, '{}'::jsonb) || excluded.metadata;
end;
$$;
