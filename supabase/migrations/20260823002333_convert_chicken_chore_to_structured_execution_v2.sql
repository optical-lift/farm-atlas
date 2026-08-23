do $migration$
declare
  v_farm_id uuid;
  v_org_id uuid;
  v_feed_id uuid;
  v_water_bucket_id uuid;
  v_coop_id uuid;
  v_occ record;
  v_task_id uuid;
begin
  select id,organization_id into v_farm_id,v_org_id
  from atlas.farms where id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  if v_farm_id is null then raise exception 'Elm Farm not found.'; end if;

  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,metadata)
  values(v_farm_id,'chicken_feed','Chicken feed','consumable','animal_feed','unknown',true,jsonb_build_object('structuredExecutionSource','chicken_chore_v1'))
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,consumable=true,updated_at=now()
  returning id into v_feed_id;

  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,metadata)
  values(v_farm_id,'chicken_water_bucket','Water bucket','container','animal_care','unknown',false,jsonb_build_object('structuredExecutionSource','chicken_chore_v1'))
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,consumable=false,updated_at=now()
  returning id into v_water_bucket_id;

  select id into v_coop_id from atlas.growing_objects where farm_id=v_farm_id and stable_key='chicken_coop_main' limit 1;
  if v_coop_id is null then raise exception 'Chicken Coop Main Area object not found.'; end if;

  for v_occ in
    select o.id,o.released_task_id
    from atlas.planned_work_occurrences o
    join atlas.work_definitions d on d.id=o.work_definition_id
    where o.farm_id=v_farm_id and d.stable_key='anna_chicken_chore_daily_except_sunday'
  loop
    insert into atlas.work_execution_components(
      organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,
      value_numeric,unit,resource_id,required,sort_order,source
    ) values
      (v_org_id,v_farm_id,v_occ.id,'feed','input','feed','Chicken feed',4,'scoops',v_feed_id,true,10,'chicken_chore_v1'),
      (v_org_id,v_farm_id,v_occ.id,'water_bucket','resource','refresh','Water bucket',null,null,v_water_bucket_id,true,20,'chicken_chore_v1'),
      (v_org_id,v_farm_id,v_occ.id,'eggs','output','gather','Eggs',null,null,null,true,30,'chicken_chore_v1'),
      (v_org_id,v_farm_id,v_occ.id,'coop','place','work_location','Chicken Coop',null,null,null,true,40,'chicken_chore_v1')
    on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
      component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
      value_numeric=excluded.value_numeric,unit=excluded.unit,resource_id=excluded.resource_id,
      required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    update atlas.work_execution_components
    set object_id=v_coop_id,reference_kind='growing_object',reference_id=v_coop_id,updated_at=now()
    where planned_occurrence_id=v_occ.id and component_key='coop';

    insert into atlas.work_execution_relations(
      organization_id,farm_id,planned_occurrence_id,relation_key,relation_kind,
      from_component_key,to_component_key,sort_order,source
    ) values
      (v_org_id,v_farm_id,v_occ.id,'feed_at_coop','at','feed','coop',10,'chicken_chore_v1'),
      (v_org_id,v_farm_id,v_occ.id,'water_at_coop','at','water_bucket','coop',20,'chicken_chore_v1'),
      (v_org_id,v_farm_id,v_occ.id,'eggs_from_coop','from','eggs','coop',30,'chicken_chore_v1')
    on conflict (planned_occurrence_id,relation_key) where planned_occurrence_id is not null do update set
      relation_kind=excluded.relation_kind,from_component_key=excluded.from_component_key,to_component_key=excluded.to_component_key,
      sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    update atlas.planned_work_occurrences o
    set task_payload=(o.task_payload-'note')||jsonb_build_object(
          'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)
            -'feed_scoops'-'refresh_water_bucket'-'gather_eggs'-'detail_lines'-'display_detail'-'display_subject')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1')
        ),
        relation_payload=jsonb_build_object(
          'task_objects',jsonb_build_array(jsonb_build_object('object_id',v_coop_id,'role','work_location')),
          'task_resource_requirements',jsonb_build_array(
            jsonb_build_object('resource_id',v_feed_id,'requirement_role','consumed','requirement_source','system_generated','quantity_needed',4,'unit','scoops','status','needed'),
            jsonb_build_object('resource_id',v_water_bucket_id,'requirement_role','required','requirement_source','system_generated','status','needed')
          )
        ),
        metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
        updated_at=now()
    where o.id=v_occ.id;

    v_task_id:=v_occ.released_task_id;
    if v_task_id is not null then
      update atlas.tasks t
      set note=null,
          metadata=(coalesce(t.metadata,'{}'::jsonb)
            -'feed_scoops'-'refresh_water_bucket'-'gather_eggs'-'detail_lines'-'display_detail'-'display_subject')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),
          updated_at=now()
      where t.id=v_task_id;

      insert into atlas.task_objects(task_id,object_id,role)
      values(v_task_id,v_coop_id,'work_location')
      on conflict(task_id,object_id) do update set role=excluded.role;

      if not exists(select 1 from atlas.task_resource_requirements where task_id=v_task_id and resource_id=v_feed_id and requirement_role='consumed') then
        insert into atlas.task_resource_requirements(task_id,resource_id,requirement_role,requirement_source,quantity_needed,unit,status,metadata)
        values(v_task_id,v_feed_id,'consumed','system_generated',4,'scoops','needed',jsonb_build_object('structuredExecution',true));
      end if;
      if not exists(select 1 from atlas.task_resource_requirements where task_id=v_task_id and resource_id=v_water_bucket_id and requirement_role='required') then
        insert into atlas.task_resource_requirements(task_id,resource_id,requirement_role,requirement_source,status,metadata)
        values(v_task_id,v_water_bucket_id,'required','system_generated','needed',jsonb_build_object('structuredExecution',true));
      end if;

      perform atlas.copy_work_execution_structure_to_task_v1(v_occ.id,v_task_id);
    end if;
  end loop;
end;
$migration$;