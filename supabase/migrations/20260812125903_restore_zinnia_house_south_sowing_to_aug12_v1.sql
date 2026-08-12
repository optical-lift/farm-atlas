do $block$
declare
  v_task atlas.tasks%rowtype;
  v_anna atlas.farm_memberships%rowtype;
begin
  select t.* into v_task
  from atlas.tasks t
  where t.metadata->>'task_key'='zinnia_2026_s5_house_south_sow'
  order by t.created_at desc
  limit 1;

  if v_task.id is null or v_task.status<>'open' then
    return;
  end if;

  select m.* into v_anna
  from atlas.farm_memberships m
  where m.farm_id=v_task.farm_id and m.worker_key='anna' and m.active=true
  order by m.created_at
  limit 1;

  if v_anna.id is null then
    raise exception 'Anna active farm membership is missing; refusing sowing schedule repair.';
  end if;

  update atlas.tasks
  set due_date='2026-08-12'::date,
      assigned_membership_id=v_anna.id,
      assigned_user_id=v_anna.user_id,
      visibility_scope='assigned_worker',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'assigned_to','Anna',
        'assignee_key','anna',
        'executor_role','farm_hand',
        'executor_worker_key','anna',
        'executor_membership_id',v_anna.id,
        'execution_date','2026-08-12',
        'window_key','evening',
        'work_window_key','evening',
        'work_order_anchor','evening',
        'sowing_evening_policy',true,
        'owner_scheduled_date','2026-08-12',
        'owner_schedule_reason','Restore overdue sowing move to the current worker Day.'
      ),
      updated_at=now()
  where id=v_task.id;
end;
$block$;
