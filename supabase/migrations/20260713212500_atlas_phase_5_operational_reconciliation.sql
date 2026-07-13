-- Atlas Phase 5: derive actionable crop work from canonical crop-cycle state.

create or replace function atlas.reconcile_operational_work_v1(
  p_farm_key text default 'elm_farm',
  p_anchor_date date default current_date,
  p_days integer default 31
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm_id uuid;
  v_end_date date;
  v_closed integer := 0;
begin
  if p_days < 1 or p_days > 93 then
    raise exception using errcode = '22023', message = 'Operational reconciliation window must be between 1 and 93 days.';
  end if;

  select f.id into v_farm_id from atlas.farms f where f.stable_key = p_farm_key;
  if v_farm_id is null then
    raise exception using errcode = 'P0002', message = 'Farm not found.';
  end if;
  v_end_date := p_anchor_date + (p_days - 1);

  update atlas.tasks t
  set status = 'done', completed_at = coalesce(t.completed_at, now()), completed_by = coalesce(t.completed_by, 'atlas_phase_5'), updated_at = now()
  from atlas.crop_cycles c
  where t.farm_id = v_farm_id
    and t.generated_from = 'crop_cycle_milestone'
    and t.generated_from_id = c.id
    and t.status in ('open', 'blocked')
    and ((t.action_key = 'germination_check' and c.germination_checked_date is not null)
      or (t.action_key = 'harvest_watch' and c.harvest_started_date is not null)
      or (t.action_key = 'clear_bed' and (c.cleared_date is not null or c.lifecycle_status <> 'active')));
  get diagnostics v_closed = row_count;

  with candidates as (
    select c.*, o.zone_id, o.label as object_label
    from atlas.crop_cycles c join atlas.growing_objects o on o.id = c.object_id
    where c.farm_id = v_farm_id and c.lifecycle_status = 'active'
      and c.germination_checked_date is null and c.expected_germination_start is not null
      and c.expected_germination_start <= v_end_date
      and coalesce(c.expected_germination_end, c.expected_germination_start) >= p_anchor_date - 7
  ), inserted as (
    insert into atlas.tasks (farm_id, zone_id, title, task_type, status, priority, due_date, generated_from, generated_from_id, action_key, work_class, task_series_key, engine_instance_key, note, metadata)
    select v_farm_id, c.zone_id, 'Check germination — ' || c.crop_label || ' · ' || c.object_label,
      'germination_check', 'open', case when coalesce(c.expected_germination_end,c.expected_germination_start) < p_anchor_date then 'high' else 'normal' end,
      c.expected_germination_start, 'crop_cycle_milestone', c.id, 'germination_check', 'crop_cycle',
      'crop:'||c.id||':germination', 'crop:'||c.id||':germination',
      'Confirm emergence and stand condition against the named crop cycle.',
      jsonb_build_object('crop_cycle_id',c.id,'crop_cycle_key',c.crop_cycle_key,'crop_label',c.crop_label,'milestone','germination_check','phase',5)
    from candidates c
    on conflict (farm_id, engine_instance_key) where engine_instance_key is not null and status in ('open','blocked')
    do update set due_date=excluded.due_date,title=excluded.title,priority=excluded.priority,metadata=excluded.metadata,updated_at=now()
    returning id, generated_from_id
  )
  insert into atlas.task_objects (task_id, object_id, role)
  select i.id, c.object_id, 'target' from inserted i join atlas.crop_cycles c on c.id=i.generated_from_id
  on conflict (task_id, object_id) do nothing;

  with candidates as (
    select c.*, o.zone_id, o.label as object_label
    from atlas.crop_cycles c join atlas.growing_objects o on o.id = c.object_id
    where c.farm_id = v_farm_id and c.lifecycle_status = 'active'
      and c.harvest_started_date is null and c.expected_harvest_watch_start is not null
      and c.expected_harvest_watch_start <= v_end_date
      and coalesce(c.expected_harvest_watch_end,c.expected_harvest_watch_start) >= p_anchor_date - 7
  ), inserted as (
    insert into atlas.tasks (farm_id, zone_id, title, task_type, status, priority, due_date, generated_from, generated_from_id, action_key, work_class, task_series_key, engine_instance_key, note, metadata)
    select v_farm_id, c.zone_id, 'Harvest watch — '||c.crop_label||' · '||c.object_label,
      'harvest_watch','open',case when coalesce(c.expected_harvest_watch_end,c.expected_harvest_watch_start) < p_anchor_date then 'high' else 'normal' end,
      c.expected_harvest_watch_start,'crop_cycle_milestone',c.id,'harvest_watch','crop_cycle',
      'crop:'||c.id||':harvest','crop:'||c.id||':harvest',
      'Check the named crop for first usable harvest; log harvest against the crop cycle.',
      jsonb_build_object('crop_cycle_id',c.id,'crop_cycle_key',c.crop_cycle_key,'crop_label',c.crop_label,'milestone','harvest_watch','phase',5)
    from candidates c
    on conflict (farm_id, engine_instance_key) where engine_instance_key is not null and status in ('open','blocked')
    do update set due_date=excluded.due_date,title=excluded.title,priority=excluded.priority,metadata=excluded.metadata,updated_at=now()
    returning id, generated_from_id
  )
  insert into atlas.task_objects (task_id, object_id, role)
  select i.id,c.object_id,'target' from inserted i join atlas.crop_cycles c on c.id=i.generated_from_id
  on conflict (task_id, object_id) do nothing;

  with candidates as (
    select c.*, o.zone_id, o.label as object_label
    from atlas.crop_cycles c join atlas.growing_objects o on o.id = c.object_id
    where c.farm_id = v_farm_id and c.lifecycle_status = 'active' and c.cleared_date is null
      and c.expected_clear_date is not null and c.expected_clear_date <= v_end_date and c.expected_clear_date >= p_anchor_date - 7
  ), inserted as (
    insert into atlas.tasks (farm_id, zone_id, title, task_type, status, priority, due_date, generated_from, generated_from_id, action_key, work_class, task_series_key, engine_instance_key, note, metadata)
    select v_farm_id,c.zone_id,'Clear and reset — '||c.crop_label||' · '||c.object_label,
      'bed_turnover','open','normal',c.expected_clear_date,'crop_cycle_milestone',c.id,'clear_bed','crop_cycle',
      'crop:'||c.id||':clear','crop:'||c.id||':clear','Close the crop cycle only when the physical object is actually cleared.',
      jsonb_build_object('crop_cycle_id',c.id,'crop_cycle_key',c.crop_cycle_key,'crop_label',c.crop_label,'milestone','clear_bed','phase',5)
    from candidates c
    on conflict (farm_id, engine_instance_key) where engine_instance_key is not null and status in ('open','blocked')
    do update set due_date=excluded.due_date,title=excluded.title,metadata=excluded.metadata,updated_at=now()
    returning id, generated_from_id
  )
  insert into atlas.task_objects (task_id, object_id, role)
  select i.id,c.object_id,'target' from inserted i join atlas.crop_cycles c on c.id=i.generated_from_id
  on conflict (task_id, object_id) do nothing;

  update atlas.object_state s set active_task_count=q.task_count,updated_at=now()
  from (select o.id object_id,count(t.id)::integer task_count from atlas.growing_objects o
    left join atlas.task_objects x on x.object_id=o.id
    left join atlas.tasks t on t.id=x.task_id and t.status in ('open','blocked')
    where o.farm_id=v_farm_id group by o.id) q
  where s.object_id=q.object_id;

  return jsonb_build_object('ok',true,'farm_key',p_farm_key,'anchor_date',p_anchor_date,'end_date',v_end_date,'closed',v_closed);
end;
$$;

revoke all on function atlas.reconcile_operational_work_v1(text,date,integer) from public, anon, authenticated;
grant execute on function atlas.reconcile_operational_work_v1(text,date,integer) to service_role;
