do $$
declare
  v_farm_id uuid;
  v_canonical_task_id uuid;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key='elm_farm'
  limit 1;

  if v_farm_id is null then
    raise exception 'Elm Farm is required for cafe-light duplicate cleanup.';
  end if;

  select t.id into v_canonical_task_id
  from atlas.tasks t
  join atlas.farm_memberships fm on fm.id=t.assigned_membership_id
  where t.farm_id=v_farm_id
    and fm.worker_key='anna'
    and t.status='open'
    and t.title='Hang conference-room café lights + porch solar lights'
  order by t.created_at desc
  limit 1;

  if v_canonical_task_id is null then
    raise exception 'Canonical combined cafe-light task was not found.';
  end if;

  update atlas.planned_work_occurrences pwo
  set state='cancelled',
      metadata=coalesce(pwo.metadata,'{}'::jsonb)||jsonb_build_object(
        'duplicate_retired_reason','merged_into_combined_cafe_and_solar_lights_move_20260809',
        'merged_into_task_id',v_canonical_task_id,
        'retired_at',now()
      ),
      updated_at=now()
  where pwo.source_kind='project_pull_item'
    and pwo.source_id in (
      select i.id
      from atlas.project_pull_items i
      join atlas.projects p on p.id=i.project_id
      where p.stable_key='elm_finish_renovation_pool'
        and i.title in (
          'Anna — Hang Cafe Lights in Meeting Room',
          'Anna — Hang Cafe Lights on Porch'
        )
    )
    and pwo.state not in ('cancelled','completed');

  update atlas.project_pull_items i
  set status='archived',
      active_task_id=null,
      metadata=coalesce(i.metadata,'{}'::jsonb)||jsonb_build_object(
        'duplicate_retired_reason','merged_into_combined_cafe_and_solar_lights_move_20260809',
        'merged_into_task_id',v_canonical_task_id,
        'retired_at',now()
      ),
      updated_at=now()
  from atlas.projects p
  where p.id=i.project_id
    and p.stable_key='elm_finish_renovation_pool'
    and i.title in (
      'Anna — Hang Cafe Lights in Meeting Room',
      'Anna — Hang Cafe Lights on Porch'
    );

  update atlas.tasks t
  set status=case when t.status in ('open','blocked') then 'archived' else t.status end,
      due_date=case when t.status in ('open','blocked') then null else t.due_date end,
      completed_at=case when t.status in ('open','blocked') then null else t.completed_at end,
      metadata=(coalesce(t.metadata,'{}'::jsonb) - 'project_pull_item_id' - 'project_pull_service_date')
        || jsonb_build_object(
          'duplicate_retired_reason','merged_into_combined_cafe_and_solar_lights_move_20260809',
          'merged_into_task_id',v_canonical_task_id,
          'retired_at',now()
        ),
      updated_at=now()
  where t.farm_id=v_farm_id
    and t.id<>v_canonical_task_id
    and t.title in (
      'Anna — Hang Cafe Lights in Meeting Room',
      'Anna — Hang Cafe Lights on Porch'
    );
end;
$$;
