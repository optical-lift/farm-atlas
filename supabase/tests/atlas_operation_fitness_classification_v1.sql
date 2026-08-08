begin;

do $proof$
declare
  v_class text;
  v_task atlas.tasks%rowtype;
  v_effective text;
  v_count integer;
begin
  select count(*)::integer into v_count
  from atlas.operation_classes
  where active;

  if v_count < 17 then
    raise exception 'Expected at least 17 active operation classes; found %.', v_count;
  end if;

  select operation_class into v_class
  from atlas.task_operation_class_v1(
    'Plant tulip bulbs',
    'plant',
    'planting',
    jsonb_build_object('plant_part','bulb')
  );
  if v_class <> 'establish_belowground' then
    raise exception 'Bulb planting resolved to %, expected establish_belowground.', v_class;
  end if;

  select operation_class into v_class
  from atlas.task_operation_class_v1(
    'Weed a bed',
    'weed',
    'maintenance',
    '{}'::jsonb
  );
  if v_class <> 'remove_uproot' then
    raise exception 'Weeding resolved to %, expected remove_uproot.', v_class;
  end if;

  select operation_class into v_class
  from atlas.task_operation_class_v1(
    'Harvest carrots',
    'harvest',
    'harvest',
    jsonb_build_object('plant_part','root')
  );
  if v_class <> 'harvest_belowground' then
    raise exception 'Root harvest resolved to %, expected harvest_belowground.', v_class;
  end if;

  select task.* into v_task
  from atlas.tasks task
  where task.metadata ->> 'task_key' = 'anna_20260716_divide_lilac_haven_irises_into_drifts'
  limit 1;

  if v_task.id is null then
    raise exception 'Lilac Haven iris division task is missing.';
  end if;
  if v_task.status <> 'open' then
    raise exception 'Iris division should remain open farm truth; found status %.', v_task.status;
  end if;
  if v_task.due_date is not null then
    raise exception 'Iris division should be floating with no live due date; found %.', v_task.due_date;
  end if;
  if v_task.commitment_kind <> 'floating' then
    raise exception 'Iris division should remain floating; found %.', v_task.commitment_kind;
  end if;
  if v_task.operation_class <> 'divide_reestablish_belowground' then
    raise exception 'Iris division operation class is %.', v_task.operation_class;
  end if;
  if v_task.operation_class_source <> 'manual' then
    raise exception 'Iris division should preserve explicit operation provenance; found %.', v_task.operation_class_source;
  end if;
  if v_task.metadata ->> 'plant_part' <> 'rhizome' then
    raise exception 'Iris division plant part is not rhizome.';
  end if;
  if v_task.metadata ->> 'lunar_family' <> 'belowground_planting' then
    raise exception 'Legacy lunar compatibility should now read belowground_planting; found %.', v_task.metadata ->> 'lunar_family';
  end if;

  select capacity.effective_obligation_class into v_effective
  from atlas.task_capacity_plan_v1(v_task, date '2026-08-08') capacity;

  if v_effective = 'recovery_work' then
    raise exception 'Floating iris division is still being treated as recovery work.';
  end if;
end;
$proof$;

rollback;
