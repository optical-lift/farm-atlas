begin;

do $proof$
declare
  v_task_count integer;
  v_checklist_count integer;
  v_total_minutes integer;
  v_bad_occurrence_dates integer;
  v_old_active integer;
begin
  select count(*)::integer
  into v_task_count
  from atlas.tasks task
  where task.farm_id = '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'
    and task.due_date = date '2026-08-05'
    and task.status in ('open','blocked')
    and task.task_series_key in (
      'community_thursday_wednesday_outdoor',
      'community_thursday_wednesday_coffee_water',
      'community_thursday_wednesday_rooms',
      'community_thursday_wednesday_trash'
    );

  if v_task_count <> 4 then
    raise exception 'Expected four current Thursday morning task clusters; found %.', v_task_count;
  end if;

  select count(*)::integer
  into v_checklist_count
  from atlas.task_execution_checklist_items item
  join atlas.tasks task on task.id = item.task_id
  where task.due_date = date '2026-08-05'
    and task.status in ('open','blocked')
    and task.task_series_key like 'community_thursday_wednesday_%'
    and coalesce(item.metadata ->> 'retired','false') <> 'true';

  if v_checklist_count <> 10 then
    raise exception 'Expected ten active checklist lines across the four clusters; found %.', v_checklist_count;
  end if;

  select sum(profile.expected_active_minutes)::integer
  into v_total_minutes
  from atlas.task_capacity_profiles profile
  join atlas.tasks task on task.id = profile.task_id
  where task.due_date = date '2026-08-05'
    and task.status in ('open','blocked')
    and task.task_series_key like 'community_thursday_wednesday_%';

  if v_total_minutes <> 120 then
    raise exception 'Expected 120 private capacity minutes across the four clusters; found %.', v_total_minutes;
  end if;

  select count(*)::integer
  into v_bad_occurrence_dates
  from (
    select occurrence.planned_due_date
    from atlas.planned_work_occurrences occurrence
    where occurrence.planned_due_date >= date '2026-08-05'
      and occurrence.occurrence_key like 'community_thursday_wednesday_%:%'
    group by occurrence.planned_due_date
    having count(*) <> 4
  ) bad_date;

  if v_bad_occurrence_dates <> 0 then
    raise exception 'Every planned Thursday morning date must contain four cluster occurrences.';
  end if;

  select count(*)::integer
  into v_old_active
  from atlas.work_definitions definition
  join atlas.work_release_policies policy on policy.work_definition_id = definition.id
  where definition.metadata ->> 'series_key' = 'community_thursday_wednesday_setup'
    and (definition.active or policy.active);

  if v_old_active <> 0 then
    raise exception 'The original oversized Thursday-morning release contract is still active.';
  end if;
end;
$proof$;

rollback;
