create or replace function atlas.refresh_production_postharvest_gate_v1(p_harvest_lot_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare
  v_harvest atlas.production_harvest_lots%rowtype;
  v_gate atlas.production_postharvest_gates%rowtype;
  v_source_task atlas.tasks%rowtype;
  v_task atlas.tasks%rowtype;
  v_owner_membership uuid;
  v_assigned numeric:=0;v_conditioned numeric:=0;v_cooled numeric:=0;v_released numeric:=0;v_returned numeric:=0;
  v_status text;v_blocker text;v_today date:=(now() at time zone 'America/Chicago')::date;
begin
  select * into v_harvest from atlas.production_harvest_lots where id=p_harvest_lot_id for update;
  if v_harvest.id is null then raise exception 'Harvest lot was not found' using errcode='P0002';end if;
  select t.* into v_source_task from atlas.tasks t where t.id=v_harvest.source_task_id;
  select
    coalesce(sum(assigned_stems) filter(where assignment_status<>'void'),0),
    coalesce(sum(assigned_stems) filter(where assignment_status in ('cooling','ready_for_product','released','awaiting_wash','returned_clean')),0),
    coalesce(sum(assigned_stems) filter(where assignment_status in ('ready_for_product','released','awaiting_wash','returned_clean')),0),
    coalesce(sum(assigned_stems) filter(where assignment_status in ('released','awaiting_wash','returned_clean')),0),
    coalesce(sum(assigned_stems) filter(where assignment_status='returned_clean'),0)
  into v_assigned,v_conditioned,v_cooled,v_released,v_returned
  from atlas.production_harvest_container_assignments
  where harvest_lot_id=v_harvest.id;
  if v_harvest.marketable_stems+v_harvest.seconds_stems=0 then v_status:='closed';v_blocker:=null;
  elsif v_assigned<v_harvest.marketable_stems+v_harvest.seconds_stems then v_status:='waiting_container_assignment';v_blocker:=(v_harvest.marketable_stems+v_harvest.seconds_stems-v_assigned)::text||' usable stems do not have container custody.';
  elsif v_conditioned<v_assigned then v_status:='waiting_conditioning';v_blocker:='Assigned stems have not all been conditioned.';
  elsif v_cooled<v_assigned then v_status:='waiting_cooling';v_blocker:='Conditioned stems have not all reached cooling.';
  elsif v_released=0 then v_status:='ready_for_product';v_blocker:=null;
  elsif v_released<v_assigned then v_status:='partially_released';v_blocker:=(v_assigned-v_released)::text||' cooled stems remain in postharvest custody.';
  elsif v_returned<v_released then v_status:='released';v_blocker:=(v_released-v_returned)::text||' released-stem container capacity still awaits wash return.';
  else v_status:='closed';v_blocker:=null;end if;
  insert into atlas.production_postharvest_gates(farm_id,harvest_lot_id,required_custody_stems,assigned_stems,conditioned_stems,cooled_stems,released_stems,gate_status,blocker_text,refresh_version,metadata)
  values(v_harvest.farm_id,v_harvest.id,v_harvest.marketable_stems+v_harvest.seconds_stems,v_assigned,v_conditioned,v_cooled,v_released,v_status,v_blocker,1,jsonb_build_object('returned_clean_stems',v_returned))
  on conflict(harvest_lot_id) do update set required_custody_stems=excluded.required_custody_stems,assigned_stems=excluded.assigned_stems,conditioned_stems=excluded.conditioned_stems,cooled_stems=excluded.cooled_stems,released_stems=excluded.released_stems,gate_status=excluded.gate_status,blocker_text=excluded.blocker_text,refresh_version=atlas.production_postharvest_gates.refresh_version+1,metadata=atlas.production_postharvest_gates.metadata||excluded.metadata,updated_at=now() returning * into v_gate;
  update atlas.production_harvest_lots set status=case v_status when 'waiting_container_assignment' then 'waiting_container_assignment' when 'waiting_conditioning' then 'conditioning' when 'waiting_cooling' then 'cooling' when 'ready_for_product' then 'ready_for_product' when 'partially_released' then 'partially_released' when 'released' then 'released' when 'closed' then 'closed' else status end,updated_at=now() where id=v_harvest.id;
  if v_status='waiting_container_assignment' then
    select * into v_task from atlas.tasks where id=v_gate.owner_assignment_task_id;
    if v_task.id is null or v_task.status not in ('open','blocked') then
      select id into v_owner_membership from atlas.farm_memberships where farm_id=v_harvest.farm_id and active and role='owner' order by created_at limit 1;
      insert into atlas.tasks(farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id)
      values(v_harvest.farm_id,'Owner — Assign clean containers — '||v_harvest.lot_label,'postharvest_container_assignment','open','high',v_harvest.harvest_date,'production_postharvest_gate',v_gate.id,'Assign clean measured containers to every usable harvested stem. Do not count discarded stems.',jsonb_build_object('task_key','postharvest_container_assignment_'||v_gate.id::text,'owner_task',true,'harvest_lot_id',v_harvest.id,'production_lot_id',v_harvest.production_lot_id,'required_custody_stems',v_gate.required_custody_stems,'assigned_stems',v_assigned,'display_action','Assign containers','display_subject',v_harvest.lot_label,'display_detail',v_blocker,'collection_zone','Owner'),'assign','light','harvest-lot:'||v_harvest.id::text||':container-assignment','postharvest-container-assignment:'||v_gate.id::text,'owner',v_owner_membership) returning * into v_task;
      update atlas.production_postharvest_gates set owner_assignment_task_id=v_task.id where id=v_gate.id;
      insert into atlas.production_harvest_lot_tasks(harvest_lot_id,task_id,link_role,metadata) values(v_harvest.id,v_task.id,'container_assignment',jsonb_build_object('postharvest_gate_id',v_gate.id));
    end if;
  end if;
  if v_status='waiting_conditioning' then
    select * into v_task from atlas.tasks where id=v_gate.conditioning_task_id;
    if v_task.id is null or v_task.status not in ('open','blocked') then
      insert into atlas.tasks(farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id)
      values(v_harvest.farm_id,'Condition harvested stems — '||v_harvest.lot_label,'production_postharvest_conditioning','open','high',v_harvest.harvest_date,'production_postharvest_gate',v_gate.id,'Confirm every assigned container has entered the crop-appropriate conditioning step.',jsonb_build_object('task_key','postharvest_conditioning_'||v_gate.id::text,'task_style','postharvest_conditioning','harvest_lot_id',v_harvest.id,'production_lot_id',v_harvest.production_lot_id,'assigned_stems',v_assigned,'display_action','Condition','display_subject',v_harvest.lot_label,'display_detail',v_assigned::text||' stems in assigned containers','collection_zone','Postharvest'),'condition','standard','harvest-lot:'||v_harvest.id::text||':conditioning','postharvest-conditioning:'||v_gate.id::text,coalesce(v_source_task.visibility_scope,'assigned_worker'),v_source_task.assigned_membership_id) returning * into v_task;
      update atlas.production_postharvest_gates set conditioning_task_id=v_task.id where id=v_gate.id;
      insert into atlas.production_harvest_lot_tasks(harvest_lot_id,task_id,link_role,metadata) values(v_harvest.id,v_task.id,'conditioning',jsonb_build_object('postharvest_gate_id',v_gate.id));
    end if;
  end if;
  if v_status='waiting_cooling' then
    select * into v_task from atlas.tasks where id=v_gate.cooling_task_id;
    if v_task.id is null or v_task.status not in ('open','blocked') then
      insert into atlas.tasks(farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id)
      values(v_harvest.farm_id,'Move conditioned stems to cooling — '||v_harvest.lot_label,'production_postharvest_cooling','open','high',v_harvest.harvest_date,'production_postharvest_gate',v_gate.id,'Move every conditioned container into its confirmed cooling location.',jsonb_build_object('task_key','postharvest_cooling_'||v_gate.id::text,'task_style','postharvest_cooling','harvest_lot_id',v_harvest.id,'production_lot_id',v_harvest.production_lot_id,'conditioned_stems',v_conditioned,'display_action','Cool','display_subject',v_harvest.lot_label,'display_detail',v_conditioned::text||' conditioned stems','collection_zone','Postharvest'),'cool','standard','harvest-lot:'||v_harvest.id::text||':cooling','postharvest-cooling:'||v_gate.id::text,coalesce(v_source_task.visibility_scope,'assigned_worker'),v_source_task.assigned_membership_id) returning * into v_task;
      update atlas.production_postharvest_gates set cooling_task_id=v_task.id where id=v_gate.id;
      insert into atlas.production_harvest_lot_tasks(harvest_lot_id,task_id,link_role,metadata) values(v_harvest.id,v_task.id,'cooling',jsonb_build_object('postharvest_gate_id',v_gate.id));
    end if;
  end if;
  if v_status in ('released','partially_released') and exists(select 1 from atlas.production_harvest_container_assignments where harvest_lot_id=v_harvest.id and assignment_status='awaiting_wash') then
    select * into v_task from atlas.tasks where id=v_gate.wash_task_id;
    if v_task.id is null or v_task.status not in ('open','blocked') then
      insert into atlas.tasks(farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,action_key,work_class,task_series_key,engine_instance_key,visibility_scope,assigned_membership_id)
      values(v_harvest.farm_id,'Wash released harvest containers — '||v_harvest.lot_label,'postharvest_container_wash','open','medium',v_today,'production_postharvest_gate',v_gate.id,'Wash every released container and return it to clean available inventory.',jsonb_build_object('task_key','postharvest_wash_'||v_gate.id::text,'task_style','postharvest_container_wash','harvest_lot_id',v_harvest.id,'production_lot_id',v_harvest.production_lot_id,'display_action','Wash containers','display_subject',v_harvest.lot_label,'display_detail',(v_released-v_returned)::text||' stems of container capacity awaiting wash','collection_zone','Postharvest'),'wash','standard','harvest-lot:'||v_harvest.id::text||':wash','postharvest-wash:'||v_gate.id::text,coalesce(v_source_task.visibility_scope,'assigned_worker'),v_source_task.assigned_membership_id) returning * into v_task;
      update atlas.production_postharvest_gates set wash_task_id=v_task.id where id=v_gate.id;
      insert into atlas.production_harvest_lot_tasks(harvest_lot_id,task_id,link_role,metadata) values(v_harvest.id,v_task.id,'wash',jsonb_build_object('postharvest_gate_id',v_gate.id));
    end if;
  end if;
  return jsonb_build_object('harvestLotId',v_harvest.id,'postharvestGateId',v_gate.id,'gateStatus',v_status,'blocker',v_blocker,'requiredCustodyStems',v_gate.required_custody_stems,'assignedStems',v_assigned,'conditionedStems',v_conditioned,'cooledStems',v_cooled,'releasedStems',v_released,'returnedCleanStems',v_returned,'ownerAssignmentTaskId',v_gate.owner_assignment_task_id,'conditioningTaskId',v_gate.conditioning_task_id,'coolingTaskId',v_gate.cooling_task_id,'washTaskId',v_gate.wash_task_id);
end;$$;