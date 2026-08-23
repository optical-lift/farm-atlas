do $migration$
declare
  v_farm_id uuid:='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  v_org_id uuid;
  v_repair_task_id uuid:='d256f453-c5fc-4562-8c9b-ab3fc5ee22e2'::uuid;
  v_dest1 uuid:='ea113c71-e844-4c0f-a882-0d93e501c2ac'::uuid;
  v_dest2 uuid:='bc7dad98-0c76-4309-bf71-cc76f172c7ca'::uuid;
  v_dest3 uuid:='397205b4-368b-4164-844d-e6f50efded96'::uuid;
  r record;
  v_occ_id uuid;
  v_target uuid;
  v_label text;
begin
  select organization_id into v_org_id from atlas.farms where id=v_farm_id;
  if v_org_id is null then raise exception 'Elm Farm organization missing.'; end if;

  for r in
    select t.id,t.planned_occurrence_id,t.metadata,
           (select o.object_id from atlas.task_objects o where o.task_id=t.id and o.role='target' limit 1) target_id
    from atlas.tasks t
    where t.farm_id=v_farm_id and t.status in ('open','blocked','in_progress')
      and t.metadata->>'serial_chain_key'='entry_billboard_reset_daily_v1'
      and t.action_key='weed'
  loop
    v_occ_id:=r.planned_occurrence_id;
    v_target:=coalesce(r.target_id,nullif(r.metadata->>'target_object_id','')::uuid);
    select label into v_label from atlas.growing_objects where id=v_target;
    if v_target is null then continue; end if;

    -- Task carrier.
    insert into atlas.work_execution_components(
      organization_id,farm_id,task_id,component_key,component_kind,component_role,label,
      reference_kind,reference_id,object_id,required,sort_order,source
    ) values
      (v_org_id,v_farm_id,r.id,'target_bed','object','target',coalesce(v_label,'Entry Billboard bed'),'growing_object',v_target,v_target,true,10,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'walkway','object_part','adjacent','Walkway',null,null,null,true,20,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'dead_biomass','material','remove','Dead biomass',null,null,null,true,30,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'excess_mulch','material','relocate','Excess mulch / compost',null,null,null,true,40,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'soil','material','preserve','Soil',null,null,null,true,50,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'destination_1','object','destination',(select label from atlas.growing_objects where id=v_dest1),'growing_object',v_dest1,v_dest1,true,60,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'destination_2','object','destination',(select label from atlas.growing_objects where id=v_dest2),'growing_object',v_dest2,v_dest2,true,61,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'destination_3','object','destination',(select label from atlas.growing_objects where id=v_dest3),'growing_object',v_dest3,v_dest3,true,62,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'repair_gate','task','condition','Raised-bed repair','task',v_repair_task_id,null,true,70,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'final_state','state','result','Planting ready',null,null,null,true,80,'entry_billboard_reset_v1')
    on conflict (task_id,component_key) where task_id is not null do update set
      component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
      reference_kind=excluded.reference_kind,reference_id=excluded.reference_id,object_id=excluded.object_id,
      required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    insert into atlas.work_execution_relations(
      organization_id,farm_id,task_id,relation_key,relation_kind,from_component_key,to_component_key,condition_component_key,sort_order,source
    ) values
      (v_org_id,v_farm_id,r.id,'walkway_of_bed','adjacent_to','walkway','target_bed',null,10,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'remove_biomass_from_bed','remove_from','dead_biomass','target_bed',null,20,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'separate_mulch_from_bed','remove_from','excess_mulch','target_bed',null,30,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'preserve_soil_in_bed','preserve_in','soil','target_bed',null,40,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'mulch_to_destination_1','into','excess_mulch','destination_1','repair_gate',50,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'mulch_to_destination_2','into','excess_mulch','destination_2','repair_gate',51,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'mulch_to_destination_3','into','excess_mulch','destination_3','repair_gate',52,'entry_billboard_reset_v1'),
      (v_org_id,v_farm_id,r.id,'bed_to_final_state','results_in','target_bed','final_state',null,60,'entry_billboard_reset_v1')
    on conflict (task_id,relation_key) where task_id is not null do update set
      relation_kind=excluded.relation_kind,from_component_key=excluded.from_component_key,to_component_key=excluded.to_component_key,
      condition_component_key=excluded.condition_component_key,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    update atlas.tasks t set
      note=null,blocker_text=null,
      metadata=(coalesce(t.metadata,'{}'::jsonb)
        -'execution_do'-'execution_how'-'execution_done_when'-'display_detail'-'clear_relocate_directive'
        -'prerequisite_gate_restore')
        ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),
      updated_at=now()
    where t.id=r.id;

    if v_occ_id is not null then
      -- Same graph on the occurrence so future/materialized cards do not regrow the prose.
      insert into atlas.work_execution_components(
        organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,
        reference_kind,reference_id,object_id,required,sort_order,source
      )
      select organization_id,farm_id,v_occ_id,component_key,component_kind,component_role,label,
             reference_kind,reference_id,object_id,required,sort_order,'entry_billboard_reset_v1'
      from atlas.work_execution_components where task_id=r.id and source='entry_billboard_reset_v1'
      on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
        component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
        reference_kind=excluded.reference_kind,reference_id=excluded.reference_id,object_id=excluded.object_id,
        required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

      insert into atlas.work_execution_relations(
        organization_id,farm_id,planned_occurrence_id,relation_key,relation_kind,from_component_key,to_component_key,condition_component_key,sort_order,source
      )
      select organization_id,farm_id,v_occ_id,relation_key,relation_kind,from_component_key,to_component_key,condition_component_key,sort_order,'entry_billboard_reset_v1'
      from atlas.work_execution_relations where task_id=r.id and source='entry_billboard_reset_v1'
      on conflict (planned_occurrence_id,relation_key) where planned_occurrence_id is not null do update set
        relation_kind=excluded.relation_kind,from_component_key=excluded.from_component_key,to_component_key=excluded.to_component_key,
        condition_component_key=excluded.condition_component_key,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

      update atlas.planned_work_occurrences o set
        task_payload=(o.task_payload-'note'-'blocker_text')||jsonb_build_object(
          'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)
            -'execution_do'-'execution_how'-'execution_done_when'-'display_detail'-'clear_relocate_directive'-'prerequisite_gate_restore')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1')
        ),
        metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
        updated_at=now()
      where o.id=v_occ_id;
    end if;
  end loop;

  -- Repair task already has the three exact target objects. Strip the prose that repeats them.
  update atlas.tasks t set
    note=null,
    metadata=(coalesce(t.metadata,'{}'::jsonb)
      -'execution_do'-'execution_how'-'execution_done_when'-'display_detail'-'day_work_order_label'
      -'fill_material_source'-'owner_rescheduled_reason'-'owner_schedule_override_reason'
      -'execution_checklist_completion_label')
      ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),
    updated_at=now()
  where t.id=v_repair_task_id;
  perform atlas.sync_task_execution_components_from_canonical_v1(v_repair_task_id);
end;
$migration$;