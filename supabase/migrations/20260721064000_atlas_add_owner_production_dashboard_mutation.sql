create or replace function atlas.owner_update_production_dashboard_v1(
  p_farm_id uuid,
  p_action text,
  p_plan_id uuid default null,
  p_succession_id uuid default null,
  p_target_start date default null,
  p_missed_strategy text default null,
  p_protect_final_succession boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_succession atlas.production_successions%rowtype;
  v_delta integer;
  v_task atlas.tasks%rowtype;
  v_new_end date;
  v_transition jsonb;
begin
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner membership required.' using errcode='42501';
  end if;

  if p_action='set_plan_policy' then
    if p_plan_id is null or p_missed_strategy not in ('skip','merge','preserve') or p_protect_final_succession is null then
      raise exception 'Invalid production policy.' using errcode='22023';
    end if;
    update atlas.production_plans
    set missed_strategy=p_missed_strategy,
        protect_final_succession=p_protect_final_succession,
        updated_at=now()
    where id=p_plan_id and farm_id=p_farm_id;
    if not found then raise exception 'Production plan was not found.' using errcode='P0002'; end if;
    return jsonb_build_object('action',p_action,'planId',p_plan_id);
  end if;

  if p_action='move_succession' then
    if p_succession_id is null or p_target_start is null then
      raise exception 'Succession and target date are required.' using errcode='22023';
    end if;
    select ps.* into v_succession
    from atlas.production_successions ps
    join atlas.production_plans pp on pp.id=ps.production_plan_id
    where ps.id=p_succession_id and pp.farm_id=p_farm_id
    for update of ps;
    if v_succession.id is null then raise exception 'Production succession was not found.' using errcode='P0002'; end if;
    if v_succession.actual_sow_date is not null then raise exception 'A sown succession cannot be moved as a plan window.' using errcode='22023'; end if;

    v_delta := p_target_start-v_succession.planned_window_start;
    v_new_end := v_succession.planned_window_end+v_delta;
    update atlas.production_successions
    set planned_window_start=p_target_start,
        planned_window_end=v_new_end,
        late_window_end=late_window_end+v_delta,
        skip_after_date=skip_after_date+v_delta,
        projected_germination_start=case when projected_germination_start is null then null else projected_germination_start+v_delta end,
        projected_germination_end=case when projected_germination_end is null then null else projected_germination_end+v_delta end,
        projected_harvest_start=case when projected_harvest_start is null then null else projected_harvest_start+v_delta end,
        projected_harvest_end=case when projected_harvest_end is null then null else projected_harvest_end+v_delta end,
        projected_clear_date=case when projected_clear_date is null then null else projected_clear_date+v_delta end,
        updated_at=now()
    where id=v_succession.id;

    if v_succession.sow_task_id is not null then
      select * into v_task from atlas.tasks where id=v_succession.sow_task_id for update;
      if v_task.id is not null and v_task.status in ('open','blocked') then
        v_transition := atlas.record_task_transition_v1_internal(
          v_task.id,'rescheduled',left('production-move:'||v_succession.id::text||':'||p_target_start::text,160),
          p_target_start,null,'Production sowing window moved.','sow','production_succession',
          jsonb_build_object('production_succession_id',v_succession.id,'previous_window_start',v_succession.planned_window_start),null
        );
        update atlas.tasks
        set note='Operating sowing window: '||p_target_start::text||' through '||v_new_end::text||'.',
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('sowing_window_start',p_target_start,'sowing_window_end',v_new_end),
            updated_at=now()
        where id=v_task.id;
      end if;
    end if;
    return jsonb_build_object('action',p_action,'successionId',v_succession.id,'plannedWindowStart',p_target_start);
  end if;

  raise exception 'Unsupported production dashboard action.' using errcode='22023';
end;
$function$;

revoke all on function atlas.owner_update_production_dashboard_v1(uuid,text,uuid,uuid,date,text,boolean) from public,anon;
grant execute on function atlas.owner_update_production_dashboard_v1(uuid,text,uuid,uuid,date,text,boolean) to authenticated,service_role;
