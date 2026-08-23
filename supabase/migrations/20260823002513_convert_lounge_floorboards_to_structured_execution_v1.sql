do $migration$
declare
  v_task atlas.tasks%rowtype;
  v_occ atlas.planned_work_occurrences%rowtype;
  v_org_id uuid;
  v_floor_id uuid;
  v_razor_id uuid;
  v_vacuum_id uuid;
begin
  select * into v_task
  from atlas.tasks
  where farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
    and metadata->>'task_key'='anna_lounge_floorboards_razor_vacuum_20260727'
    and status in ('open','blocked','in_progress')
  order by created_at desc limit 1;
  if v_task.id is null then return; end if;
  select organization_id into v_org_id from atlas.farms where id=v_task.farm_id;
  select id into v_floor_id from atlas.growing_objects where farm_id=v_task.farm_id and stable_key='lounge_floor' limit 1;
  if v_floor_id is null then raise exception 'Lounge Floor object missing.'; end if;

  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,metadata)
  values(v_task.farm_id,'razor_blade_cleaning_tool','Razor blade','tool','cleaning','unknown',false,jsonb_build_object('structuredExecutionSource','lounge_floorboards_v1'))
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,updated_at=now()
  returning id into v_razor_id;

  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,metadata)
  values(v_task.farm_id,'vacuum_cleaning_tool','Vacuum','equipment','cleaning','unknown',false,jsonb_build_object('structuredExecutionSource','lounge_floorboards_v1'))
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,updated_at=now()
  returning id into v_vacuum_id;

  if v_task.planned_occurrence_id is not null then
    select * into v_occ from atlas.planned_work_occurrences where id=v_task.planned_occurrence_id;

    insert into atlas.work_execution_components(
      organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,
      resource_id,object_id,reference_kind,reference_id,required,sort_order,source
    ) values
      (v_org_id,v_task.farm_id,v_occ.id,'floorboards','object','target','Floorboards',null,v_floor_id,'growing_object',v_floor_id,true,10,'lounge_floorboards_v1'),
      (v_org_id,v_task.farm_id,v_occ.id,'razor','resource','tool','Razor blade',v_razor_id,null,null,null,true,20,'lounge_floorboards_v1'),
      (v_org_id,v_task.farm_id,v_occ.id,'vacuum','resource','tool','Vacuum',v_vacuum_id,null,null,null,true,30,'lounge_floorboards_v1'),
      (v_org_id,v_task.farm_id,v_occ.id,'debris','material','removed_material','Loosened debris',null,null,null,null,true,40,'lounge_floorboards_v1')
    on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
      component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
      resource_id=excluded.resource_id,object_id=excluded.object_id,reference_kind=excluded.reference_kind,reference_id=excluded.reference_id,
      required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    insert into atlas.work_execution_relations(
      organization_id,farm_id,planned_occurrence_id,relation_key,relation_kind,from_component_key,to_component_key,sort_order,source
    ) values
      (v_org_id,v_task.farm_id,v_occ.id,'razor_on_floorboards','uses_on','razor','floorboards',10,'lounge_floorboards_v1'),
      (v_org_id,v_task.farm_id,v_occ.id,'razor_loosens_debris','loosens','razor','debris',20,'lounge_floorboards_v1'),
      (v_org_id,v_task.farm_id,v_occ.id,'vacuum_after_razor','after','vacuum','razor',30,'lounge_floorboards_v1'),
      (v_org_id,v_task.farm_id,v_occ.id,'vacuum_removes_debris','removes','vacuum','debris',40,'lounge_floorboards_v1')
    on conflict (planned_occurrence_id,relation_key) where planned_occurrence_id is not null do update set
      relation_kind=excluded.relation_kind,from_component_key=excluded.from_component_key,to_component_key=excluded.to_component_key,
      sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    update atlas.planned_work_occurrences o
    set title='Lounge floorboards',
        task_payload=(o.task_payload-'note')||jsonb_build_object(
          'title','Lounge floorboards',
          'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)
            -'detail_lines'-'detail_heading'-'display_detail'-'display_subject')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1')
        ),
        relation_payload=jsonb_set(coalesce(o.relation_payload,'{}'::jsonb),'{task_objects}',jsonb_build_array(jsonb_build_object('object_id',v_floor_id,'role','target')),true),
        metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
        updated_at=now()
    where o.id=v_occ.id;
  end if;

  update atlas.tasks
  set title='Lounge floorboards',note=null,
      metadata=(coalesce(metadata,'{}'::jsonb)-'detail_lines'-'detail_heading'-'display_detail'-'display_subject')
        ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),
      updated_at=now()
  where id=v_task.id;

  insert into atlas.task_objects(task_id,object_id,role) values(v_task.id,v_floor_id,'target')
  on conflict(task_id,object_id) do update set role=excluded.role;

  if v_task.planned_occurrence_id is not null then
    perform atlas.copy_work_execution_structure_to_task_v1(v_task.planned_occurrence_id,v_task.id);
  end if;

  update atlas.project_pull_items
  set title='Lounge floorboards',note=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('structured_execution_contract','work_execution_components_v1','source_task_id',v_task.id),
      updated_at=now()
  where id=nullif(v_task.metadata->>'project_pull_item_id','')::uuid;
end;
$migration$;