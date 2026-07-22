create or replace function atlas.owner_update_production_plan_v1(
  p_farm_id uuid,
  p_action text,
  p_plan_id uuid default null,
  p_succession_id uuid default null,
  p_state text default null,
  p_actual_sow_date date default null,
  p_succession_count integer default null,
  p_spacing_days integer default null,
  p_first_window_start date default null,
  p_window_length_days integer default null,
  p_late_window_days integer default null,
  p_missed_strategy text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_plan atlas.production_plans%rowtype;
  v_profile atlas.crop_profiles%rowtype;
  v_succession atlas.production_successions%rowtype;
  v_task atlas.tasks%rowtype;
  v_anna uuid;
  v_worker_key text;
  v_object_ids uuid[];
  v_claim record;
  v_cycle_id uuid;
  v_transition jsonb;
  v_start date;
  v_end date;
  v_late date;
  v_skip date;
  v_next_start date;
  v_sequence integer;
  v_existing_task_id uuid;
  v_existing_status text;
  v_title text;
  v_metadata jsonb;
  v_clear_offset integer;
  v_deleted integer := 0;
begin
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner membership required.' using errcode='42501';
  end if;

  if p_action='set_succession_state' then
    if p_succession_id is null or p_state not in ('upcoming','in_window','late','skipped','sown','germinated','harvesting','cleared') then
      raise exception 'Invalid succession state update.' using errcode='22023';
    end if;
    select ps.* into v_succession
    from atlas.production_successions ps
    join atlas.production_plans pp on pp.id=ps.production_plan_id
    where ps.id=p_succession_id and pp.farm_id=p_farm_id
    for update of ps;
    if v_succession.id is null then raise exception 'Production succession was not found.' using errcode='P0002'; end if;
    select * into v_plan from atlas.production_plans where id=v_succession.production_plan_id;
    select * into v_profile from atlas.crop_profiles where id=v_plan.crop_profile_id;
    if v_profile.id is null then raise exception 'Crop profile was not found.' using errcode='P0002'; end if;
    if v_succession.sow_task_id is not null then select * into v_task from atlas.tasks where id=v_succession.sow_task_id for update; end if;

    if p_state='sown' then
      if p_actual_sow_date is null or p_actual_sow_date<date '2000-01-01' or p_actual_sow_date>current_date+1 then
        raise exception 'Actual sow date is outside the supported range.' using errcode='22023';
      end if;
      if v_task.id is null then raise exception 'This succession has no sowing task to complete.' using errcode='22023'; end if;
      select coalesce(array_agg(distinct object_id order by object_id),'{}'::uuid[]) into v_object_ids
      from atlas.task_objects where task_id=v_task.id;
      if cardinality(v_object_ids)<1 then
        raise exception 'Link the sowing task to at least one growing area before marking it sown.' using errcode='22023';
      end if;

      select * into v_claim from atlas.record_planting_claim_v1(
        p_farm_id,p_actual_sow_date,v_profile.crop_label,v_profile.variety,'direct_sow',1,'succession',
        v_object_ids,v_profile.id,'whole_object',null,null,'field_logged',
        'Production succession '||v_succession.sequence_number::text||' marked sown.',
        left('production-sown:'||v_succession.id::text,120)
      );
      select cc.id into v_cycle_id from atlas.crop_cycles cc
      where cc.planting_claim_id=v_claim.planting_claim_id order by cc.created_at limit 1;

      if v_task.status in ('open','blocked') then
        v_transition := atlas.record_task_transition_v1_internal(
          v_task.id,'done',left('production-sown-task:'||v_succession.id::text,160),null,
          'Production succession marked sown.',null,'sow','production_succession',
          jsonb_build_object('production_succession_id',v_succession.id,'planting_claim_id',v_claim.planting_claim_id,'crop_cycle_id',v_cycle_id),
          v_claim.field_log_id
        );
      end if;
      update atlas.production_successions
      set state='sown',actual_sow_date=p_actual_sow_date,crop_cycle_id=coalesce(v_cycle_id,crop_cycle_id),skip_reason=null,updated_at=now()
      where id=v_succession.id;
      return jsonb_build_object('action',p_action,'successionId',v_succession.id,'state','sown','cropCycleId',v_cycle_id);
    end if;

    update atlas.production_successions
    set state=p_state,
        skip_reason=case when p_state='skipped' then 'Skipped from production plan.' else skip_reason end,
        updated_at=now()
    where id=v_succession.id;
    if p_state='skipped' and v_task.id is not null and v_task.status in ('open','blocked') then
      v_transition := atlas.record_task_transition_v1_internal(
        v_task.id,'changed_plan',left('production-skip:'||v_succession.id::text,160),null,
        'Succession skipped from production plan.','Succession skipped from production plan.','sow','production_succession',
        jsonb_build_object('production_succession_id',v_succession.id,'production_state','skipped'),null
      );
    end if;
    return jsonb_build_object('action',p_action,'successionId',v_succession.id,'state',p_state);
  end if;

  if p_action<>'regenerate' then raise exception 'Unsupported production plan action.' using errcode='22023'; end if;
  if p_plan_id is null or p_succession_count is null or p_succession_count<1 or p_succession_count>60
     or p_spacing_days is null or p_spacing_days<0 or p_spacing_days>120
     or p_first_window_start is null
     or p_window_length_days is null or p_window_length_days<0 or p_window_length_days>45
     or p_late_window_days is null or p_late_window_days<0 or p_late_window_days>45
     or p_missed_strategy not in ('skip','merge','preserve') then
    raise exception 'Invalid production plan settings.' using errcode='22023';
  end if;

  select * into v_plan from atlas.production_plans where id=p_plan_id and farm_id=p_farm_id for update;
  if v_plan.id is null then raise exception 'Production plan was not found.' using errcode='P0002'; end if;
  select * into v_profile from atlas.crop_profiles where id=v_plan.crop_profile_id;
  if v_profile.id is null then raise exception 'Crop profile was not found.' using errcode='P0002'; end if;
  v_clear_offset:=coalesce(v_profile.clear_offset_days,case when coalesce(v_plan.metadata->>'clear_bed_offset_days','')~'^\d+$' then (v_plan.metadata->>'clear_bed_offset_days')::integer end,85);

  update atlas.production_plans
  set succession_count=p_succession_count,spacing_days=p_spacing_days,first_window_start=p_first_window_start,
      window_length_days=p_window_length_days,late_window_days=p_late_window_days,missed_strategy=p_missed_strategy,updated_at=now()
  where id=v_plan.id;

  for v_sequence in 1..p_succession_count loop
    v_start:=p_first_window_start+((v_sequence-1)*p_spacing_days);
    v_end:=v_start+p_window_length_days;
    v_late:=v_end+p_late_window_days;
    v_next_start:=p_first_window_start+(v_sequence*p_spacing_days);
    v_skip:=case when p_missed_strategy='skip' and v_sequence<p_succession_count then greatest(v_end,v_next_start) else v_late end;

    insert into atlas.production_successions(
      production_plan_id,sequence_number,planned_window_start,planned_window_end,late_window_end,skip_after_date,
      projected_germination_start,projected_germination_end,projected_harvest_start,projected_harvest_end,projected_clear_date,state,metadata,updated_at
    ) values (
      v_plan.id,v_sequence,v_start,v_end,v_late,v_skip,
      case when v_profile.days_to_germination_min is null then null else v_start+v_profile.days_to_germination_min end,
      case when v_profile.days_to_germination_max is null then null else v_start+v_profile.days_to_germination_max end,
      case when v_profile.days_to_harvest_watch_min is null then null else v_start+v_profile.days_to_harvest_watch_min end,
      case when v_profile.days_to_harvest_watch_max is null then null else v_start+v_profile.days_to_harvest_watch_max end,
      v_start+v_clear_offset,'upcoming',jsonb_build_object('generated_from','production_plan_regeneration'),now()
    ) on conflict(production_plan_id,sequence_number) do update
    set planned_window_start=excluded.planned_window_start,planned_window_end=excluded.planned_window_end,
        late_window_end=excluded.late_window_end,skip_after_date=excluded.skip_after_date,
        projected_germination_start=excluded.projected_germination_start,projected_germination_end=excluded.projected_germination_end,
        projected_harvest_start=excluded.projected_harvest_start,projected_harvest_end=excluded.projected_harvest_end,
        projected_clear_date=excluded.projected_clear_date,
        metadata=coalesce(atlas.production_successions.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now();
  end loop;

  for v_succession in
    select * from atlas.production_successions where production_plan_id=v_plan.id and sequence_number>p_succession_count
      and actual_sow_date is null and state in ('upcoming','in_window','late','skipped') for update
  loop
    if v_succession.sow_task_id is not null then
      select * into v_task from atlas.tasks where id=v_succession.sow_task_id for update;
      if v_task.id is not null and v_task.status in ('open','blocked') then
        perform atlas.record_task_transition_v1_internal(v_task.id,'changed_plan',left('production-remove:'||v_succession.id::text,160),null,
          'Succession removed during plan regeneration.','Succession removed during plan regeneration.','sow','production_succession',jsonb_build_object('production_succession_id',v_succession.id),null);
      end if;
    end if;
    delete from atlas.production_successions where id=v_succession.id;
    v_deleted:=v_deleted+1;
  end loop;

  select fm.id,fm.worker_key into v_anna,v_worker_key
  from atlas.farm_memberships fm where fm.farm_id=p_farm_id and fm.active=true and fm.worker_key='anna' order by fm.created_at limit 1;

  for v_succession in
    select * from atlas.production_successions where production_plan_id=v_plan.id order by sequence_number
  loop
    if v_succession.state not in ('upcoming','in_window','late') then continue; end if;
    v_title:='Sow '||v_profile.crop_label||' · Succession '||v_succession.sequence_number::text||' of '||p_succession_count::text;
    v_metadata:=jsonb_build_object(
      'production_plan_id',v_plan.id,'production_succession_id',v_succession.id,'succession_number',v_succession.sequence_number,
      'succession_count',p_succession_count,'crop_profile_id',v_profile.id,'crop_profile_stable_key',v_profile.stable_key,
      'crop_label',v_profile.crop_label,'variety',v_profile.variety,'sowing_window_start',v_succession.planned_window_start,
      'sowing_window_end',v_succession.planned_window_end,'intended_uses',v_plan.intended_uses,
      'work_route','sow','work_rhythm','Seed Sowing','display_action','Sow','display_subject',v_profile.crop_label||' · Succession '||v_succession.sequence_number::text||' of '||p_succession_count::text,
      'detail_heading','Sowing window','detail_lines',jsonb_build_array(coalesce(v_plan.notes,'Production sowing succession.'),v_succession.planned_window_start::text||' through '||v_succession.planned_window_end::text),
      'location_required',true
    );

    v_existing_task_id:=v_succession.sow_task_id;
    v_existing_status:=null;
    if v_existing_task_id is not null then select status into v_existing_status from atlas.tasks where id=v_existing_task_id; end if;
    if v_existing_task_id is not null and v_existing_status in ('open','blocked') then
      if (select due_date from atlas.tasks where id=v_existing_task_id) is distinct from v_succession.planned_window_start then
        perform atlas.record_task_transition_v1_internal(v_existing_task_id,'rescheduled',left('production-sync:'||v_succession.id::text||':'||v_succession.planned_window_start::text,160),v_succession.planned_window_start,null,
          'Production plan regenerated.','sow','production_succession',jsonb_build_object('production_succession_id',v_succession.id),null);
      end if;
      update atlas.tasks
      set note='Operating sowing window: '||v_succession.planned_window_start::text||' through '||v_succession.planned_window_end::text||'.',
          metadata=coalesce(metadata,'{}'::jsonb)||v_metadata,updated_at=now()
      where id=v_existing_task_id;
    elsif v_existing_task_id is null or v_existing_status in ('archived','skipped') then
      insert into atlas.tasks(
        farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,action_key,work_class,task_series_key,
        engine_instance_key,unlock_text,note,metadata,visibility_scope,assigned_membership_id
      ) values (
        p_farm_id,v_title,'succession_sowing','open','high',v_succession.planned_window_start,'production_succession',v_succession.id,
        'sow','Seed Starting / Succession',v_plan.stable_key||':sowing','production-succession:'||v_succession.id::text,
        v_plan.notes,'Operating sowing window: '||v_succession.planned_window_start::text||' through '||v_succession.planned_window_end::text||'.',
        v_metadata||jsonb_build_object('assigned_to',v_worker_key),
        case when v_anna is null then 'management' else 'assigned_worker' end,v_anna
      ) returning id into v_existing_task_id;
      update atlas.production_successions set sow_task_id=v_existing_task_id,updated_at=now() where id=v_succession.id;
    end if;
  end loop;

  return jsonb_build_object('action',p_action,'planId',v_plan.id,'deletedSuccessions',v_deleted);
end;
$function$;

revoke all on function atlas.owner_update_production_plan_v1(uuid,text,uuid,uuid,text,date,integer,integer,date,integer,integer,text) from public,anon;
grant execute on function atlas.owner_update_production_plan_v1(uuid,text,uuid,uuid,text,date,integer,integer,date,integer,integer,text) to authenticated,service_role;
