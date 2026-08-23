do $migration$
declare
  v_farm_id uuid:='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  v_org_id uuid;
  v_bedding_id uuid;
  v_coop_id uuid;
  v_main_garden_id uuid;
  v_occ record;
begin
  select organization_id into v_org_id from atlas.farms where id=v_farm_id;
  select id into v_coop_id from atlas.growing_objects where farm_id=v_farm_id and stable_key='chicken_coop_main' limit 1;
  select id into v_main_garden_id from atlas.zones where farm_id=v_farm_id and stable_key='main_garden' limit 1;
  if v_org_id is null or v_coop_id is null or v_main_garden_id is null then raise exception 'Chicken bedding canonical identities missing.'; end if;

  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,metadata)
  values(v_farm_id,'chicken_bedding','Chicken bedding','consumable','animal_bedding','unknown',true,jsonb_build_object('structuredExecutionSource','chicken_bedding_v1'))
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,consumable=true,updated_at=now()
  returning id into v_bedding_id;

  for v_occ in
    select o.id,o.released_task_id
    from atlas.planned_work_occurrences o join atlas.work_definitions d on d.id=o.work_definition_id
    where o.farm_id=v_farm_id and d.stable_key='anna_refresh_chicken_bedding_every_5_weeks'
      and o.state not in ('completed','cancelled')
  loop
    insert into atlas.work_execution_components(
      organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,
      value_numeric,unit,reference_kind,reference_id,resource_id,object_id,zone_id,required,sort_order,source
    ) values
      (v_org_id,v_farm_id,v_occ.id,'fresh_bedding','material','input','Chicken bedding',null,null,'resource',v_bedding_id,v_bedding_id,null,null,true,10,'chicken_bedding_v1'),
      (v_org_id,v_farm_id,v_occ.id,'source','place','source','Red Barn',null,null,null,null,null,null,null,true,20,'chicken_bedding_v1'),
      (v_org_id,v_farm_id,v_occ.id,'coop','place','target','Chicken Coop',null,null,'growing_object',v_coop_id,null,v_coop_id,null,true,30,'chicken_bedding_v1'),
      (v_org_id,v_farm_id,v_occ.id,'depth','parameter','target_depth','Depth',5,'in',null,null,null,null,null,true,40,'chicken_bedding_v1'),
      (v_org_id,v_farm_id,v_occ.id,'old_bedding','material','output','Old bedding',null,null,null,null,null,null,null,true,50,'chicken_bedding_v1'),
      (v_org_id,v_farm_id,v_occ.id,'destination','place','destination','Main Garden',null,null,'zone',v_main_garden_id,null,null,v_main_garden_id,true,60,'chicken_bedding_v1'),
      (v_org_id,v_farm_id,v_occ.id,'purpose','purpose','reuse','Weed suppression',null,null,null,null,null,null,null,true,70,'chicken_bedding_v1')
    on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
      component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
      value_numeric=excluded.value_numeric,unit=excluded.unit,reference_kind=excluded.reference_kind,reference_id=excluded.reference_id,
      resource_id=excluded.resource_id,object_id=excluded.object_id,zone_id=excluded.zone_id,required=excluded.required,
      sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    insert into atlas.work_execution_relations(
      organization_id,farm_id,planned_occurrence_id,relation_key,relation_kind,from_component_key,to_component_key,sort_order,source
    ) values
      (v_org_id,v_farm_id,v_occ.id,'bedding_from_source','from','fresh_bedding','source',10,'chicken_bedding_v1'),
      (v_org_id,v_farm_id,v_occ.id,'bedding_into_coop','into','fresh_bedding','coop',20,'chicken_bedding_v1'),
      (v_org_id,v_farm_id,v_occ.id,'bedding_depth','set_to','fresh_bedding','depth',30,'chicken_bedding_v1'),
      (v_org_id,v_farm_id,v_occ.id,'old_bedding_to_destination','into','old_bedding','destination',40,'chicken_bedding_v1'),
      (v_org_id,v_farm_id,v_occ.id,'old_bedding_reuse','for','old_bedding','purpose',50,'chicken_bedding_v1')
    on conflict (planned_occurrence_id,relation_key) where planned_occurrence_id is not null do update set
      relation_kind=excluded.relation_kind,from_component_key=excluded.from_component_key,to_component_key=excluded.to_component_key,
      sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    update atlas.planned_work_occurrences o
    set title='Chicken bedding',
        task_payload=(o.task_payload-'note')||jsonb_build_object(
          'title','Chicken bedding',
          'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)
            -'detail_lines'-'display_detail'-'display_subject'-'bedding_source'-'old_bedding_use'-'target_depth_inches'-'old_bedding_destination')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1')
        ),
        relation_payload=jsonb_build_object(
          'task_objects',jsonb_build_array(jsonb_build_object('object_id',v_coop_id,'role','target')),
          'task_resource_requirements',jsonb_build_array(jsonb_build_object(
            'resource_id',v_bedding_id,'requirement_role','consumed','requirement_source','system_generated','status','needed'
          ))
        ),
        metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
        updated_at=now()
    where o.id=v_occ.id;

    if v_occ.released_task_id is not null then
      update atlas.tasks t
      set title='Chicken bedding',note=null,
          metadata=(coalesce(t.metadata,'{}'::jsonb)
            -'detail_lines'-'display_detail'-'display_subject'-'bedding_source'-'old_bedding_use'-'target_depth_inches'-'old_bedding_destination')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),
          updated_at=now()
      where t.id=v_occ.released_task_id and t.status in ('open','blocked','in_progress');
      perform atlas.copy_work_execution_structure_to_task_v1(v_occ.id,v_occ.released_task_id);
    end if;
  end loop;
end;
$migration$;