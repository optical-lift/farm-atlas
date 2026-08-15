-- Restore the Worker Day presentation invariant that was lost when the later
-- carryover/card fast paths replaced the earlier visibility-filtered functions.
--
-- system_internal tasks are state sources, not Worker Day cards.
-- They may continue to own dependencies, state and Day-cue result behavior, but
-- neither due-date/carry selection, explicit choreography placement nor card
-- hydration may turn them into a Farm Hand presentation surface.
--
-- The current function bodies contain later performance/carryover work that must
-- remain intact. Patch those exact bodies in place and fail the migration if an
-- expected seam has drifted, rather than replacing them with an older definition.

do $migration$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef('atlas.owner_worker_day_plan_v1(uuid,uuid,date)'::regprocedure)
    into v_definition;

  v_patched := replace(
    v_definition,
    E'        and t.due_date=p_day\n        and t.parent_task_id is null',
    E'        and t.due_date=p_day\n        and coalesce(t.visibility_scope,'''') <> ''system_internal''\n        and t.parent_task_id is null'
  );
  if v_patched = v_definition then
    raise exception 'owner_worker_day_plan_v1 exact-date visibility seam drifted';
  end if;
  v_definition := v_patched;

  v_patched := replace(
    v_definition,
    E'      cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity\n      where t.status = ''open''\n    )',
    E'      cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity\n      where t.status = ''open''\n        and coalesce(t.visibility_scope,'''') <> ''system_internal''\n    )'
  );
  if v_patched = v_definition then
    raise exception 'owner_worker_day_plan_v1 carry-join visibility seam drifted';
  end if;
  execute v_patched;

  select pg_get_functiondef('atlas.owner_worker_day_plan_choreographed_v1(uuid,uuid,date)'::regprocedure)
    into v_definition;
  v_patched := replace(
    v_definition,
    E'    and task.status = ''open''\n    and task.parent_task_id is null',
    E'    and task.status = ''open''\n    and coalesce(task.visibility_scope,'''') <> ''system_internal''\n    and task.parent_task_id is null'
  );
  if v_patched = v_definition then
    raise exception 'owner_worker_day_plan_choreographed_v1 placed-task visibility seam drifted';
  end if;
  execute v_patched;

  select pg_get_functiondef('atlas.worker_day_operational_task_cards_v1(uuid,uuid,uuid[])'::regprocedure)
    into v_definition;
  v_patched := replace(
    v_definition,
    E'    where task.farm_id = p_farm_id\n      and task.id = any(p_task_ids)\n      and (',
    E'    where task.farm_id = p_farm_id\n      and task.id = any(p_task_ids)\n      and coalesce(task.visibility_scope,'''') <> ''system_internal''\n      and ('
  );
  if v_patched = v_definition then
    raise exception 'worker_day_operational_task_cards_v1 visibility seam drifted';
  end if;
  execute v_patched;

  select pg_get_functiondef('atlas.worker_day_operational_task_cards_v2(uuid,uuid,date,uuid[])'::regprocedure)
    into v_definition;
  v_patched := replace(
    v_definition,
    E'    where task.farm_id = p_farm_id\n      and task.id = any(v_ids)\n      and (',
    E'    where task.farm_id = p_farm_id\n      and task.id = any(v_ids)\n      and coalesce(task.visibility_scope,'''') <> ''system_internal''\n      and ('
  );
  if v_patched = v_definition then
    raise exception 'worker_day_operational_task_cards_v2 visibility seam drifted';
  end if;
  execute v_patched;
end;
$migration$;
