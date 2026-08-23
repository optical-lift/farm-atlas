do $migration$
declare
  v_farm uuid:='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  v_org uuid;
  v_paint uuid;
  v_tape uuid;
  v_brush uuid;
  v_bag uuid;
  v_pressure uuid:='fdb2d6ca-8ab1-422e-adfd-3bc07a995876'::uuid;
  v_paint_task uuid:='c52997f0-855c-4e2a-81ff-62dec9284e4d'::uuid;
  v_wash_task uuid:='5819edd5-a537-42ba-84aa-151b4eb1a8d8'::uuid;
  v_occ uuid;
begin
  select organization_id into v_org from atlas.farms where id=v_farm;
  if v_org is null then raise exception 'Elm Farm organization missing'; end if;

  -- Pressure wash: target + pressure washer + wide fan. The method paragraphs are retired.
  insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,required,sort_order,source)
  values
    (v_org,v_farm,v_wash_task,'surface','object_part','target','Detached garage face',true,10,'venue_clean_structured_v1'),
    (v_org,v_farm,v_wash_task,'fan','parameter','spray_pattern','Wide fan',true,30,'venue_clean_structured_v1'),
    (v_org,v_farm,v_wash_task,'pressure','parameter','pressure','Low pressure',true,31,'venue_clean_structured_v1')
  on conflict (task_id,component_key) where task_id is not null do update set label=excluded.label,required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

  delete from atlas.task_execution_checklist_items where task_id=v_wash_task and coalesce(metadata->>'interaction','')='information';
  update atlas.tasks set
    title='Pressure wash · Detached garage face',
    metadata=(coalesce(metadata,'{}'::jsonb)
      -'execution_do'-'execution_how'-'execution_done_when'-'execution_checklist_template_key'-'execution_checklist_title'-'execution_checklist_kicker'
      -'display_detail'-'rescheduled_reason'-'pressure_wash_card_content_contract')
      ||jsonb_build_object('display_action','Pressure wash','display_subject','Detached garage face','structured_execution_contract','work_execution_components_v1','prose_retired',true,'quick_complete_allowed',true),
    updated_at=now()
  where id=v_wash_task;
  perform atlas.sync_task_execution_components_from_canonical_v1(v_wash_task);
  select planned_occurrence_id into v_occ from atlas.tasks where id=v_wash_task;
  if v_occ is not null then
    insert into atlas.work_execution_components(organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,required,sort_order,source)
    select organization_id,farm_id,v_occ,component_key,component_kind,component_role,label,required,sort_order,'venue_clean_structured_v1'
    from atlas.work_execution_components where task_id=v_wash_task and source='venue_clean_structured_v1'
    on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set label=excluded.label,required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();
    update atlas.planned_work_occurrences o set
      title='Pressure wash · Detached garage face',
      task_payload=(o.task_payload-'note')||jsonb_build_object(
        'title','Pressure wash · Detached garage face',
        'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)
          -'execution_do'-'execution_how'-'execution_done_when'-'execution_checklist_template_key'-'execution_checklist_title'-'execution_checklist_kicker'
          -'display_detail'-'rescheduled_reason'-'pressure_wash_card_content_contract')
          ||jsonb_build_object('display_action','Pressure wash','display_subject','Detached garage face','structured_execution_contract','work_execution_components_v1','prose_retired',true,'quick_complete_allowed',true)
      ),
      metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
      updated_at=now()
    where id=v_occ;
  end if;

  -- Door painting resources are real reusable inventory/tool concepts, not sentences.
  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,metadata)
  values(v_farm,'purple_exterior_paint','Purple exterior paint','consumable','paint','unknown',true,'{"structuredExecutionSource":"door_paint_v1"}'::jsonb)
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,consumable=true,updated_at=now()
  returning id into v_paint;
  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,metadata)
  values(v_farm,'painters_tape','Painter''s tape','consumable','paint','unknown',true,'{"structuredExecutionSource":"door_paint_v1"}'::jsonb)
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,consumable=true,updated_at=now()
  returning id into v_tape;
  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,metadata)
  values(v_farm,'paint_brushes','Paint brushes','tool','paint','unknown',false,'{"structuredExecutionSource":"door_paint_v1"}'::jsonb)
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,consumable=false,updated_at=now()
  returning id into v_brush;
  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,metadata)
  values(v_farm,'ziplock_bags','Ziplock bags','consumable','storage','unknown',true,'{"structuredExecutionSource":"door_paint_v1"}'::jsonb)
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,consumable=true,updated_at=now()
  returning id into v_bag;

  insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_numeric,unit,required,sort_order,source)
  values
    (v_org,v_farm,v_paint_task,'doors','object_part','target','Exterior house doors',2,'doors',true,10,'door_paint_structured_v1'),
    (v_org,v_farm,v_paint_task,'coat','parameter','coat','Coat',1,'of 2',true,20,'door_paint_structured_v1'),
    (v_org,v_farm,v_paint_task,'color','parameter','color','Purple',null,null,true,21,'door_paint_structured_v1')
  on conflict (task_id,component_key) where task_id is not null do update set label=excluded.label,value_numeric=excluded.value_numeric,unit=excluded.unit,required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

  if not exists(select 1 from atlas.task_resource_requirements where task_id=v_paint_task and resource_id=v_paint and requirement_role='consumed') then
    insert into atlas.task_resource_requirements(task_id,resource_id,requirement_role,requirement_source,status,metadata) values(v_paint_task,v_paint,'consumed','system_generated','needed','{"structuredExecution":true}'::jsonb);
  end if;
  if not exists(select 1 from atlas.task_resource_requirements where task_id=v_paint_task and resource_id=v_tape and requirement_role='consumed') then
    insert into atlas.task_resource_requirements(task_id,resource_id,requirement_role,requirement_source,status,metadata) values(v_paint_task,v_tape,'consumed','system_generated','needed','{"structuredExecution":true}'::jsonb);
  end if;
  if not exists(select 1 from atlas.task_resource_requirements where task_id=v_paint_task and resource_id=v_brush and requirement_role='check_first') then
    insert into atlas.task_resource_requirements(task_id,resource_id,requirement_role,requirement_source,status,metadata) values(v_paint_task,v_brush,'check_first','system_generated','needed','{"structuredExecution":true}'::jsonb);
  end if;
  if not exists(select 1 from atlas.task_resource_requirements where task_id=v_paint_task and resource_id=v_bag and requirement_role='consumed') then
    insert into atlas.task_resource_requirements(task_id,resource_id,requirement_role,requirement_source,status,metadata) values(v_paint_task,v_bag,'consumed','system_generated','needed','{"structuredExecution":true}'::jsonb);
  end if;

  -- Keep checklist state, collapse labels to object/action tokens.
  update atlas.task_execution_checklist_items set item_label='Doors · wipe',metadata=(coalesce(metadata,'{}'::jsonb)-'source')||jsonb_build_object('structuredExecution',true),updated_at=now() where task_id=v_paint_task and item_key='reset_work_01';
  update atlas.task_execution_checklist_items set item_label='Knobs + hardware · tape',metadata=(coalesce(metadata,'{}'::jsonb)-'source')||jsonb_build_object('structuredExecution',true),updated_at=now() where task_id=v_paint_task and item_key='reset_work_02';
  update atlas.task_execution_checklist_items set item_label='Purple · coat 1',metadata=(coalesce(metadata,'{}'::jsonb)-'source')||jsonb_build_object('structuredExecution',true),updated_at=now() where task_id=v_paint_task and item_key='reset_work_03';
  update atlas.task_execution_checklist_items set item_label='Brushes · Ziplock',metadata=(coalesce(metadata,'{}'::jsonb)-'source')||jsonb_build_object('structuredExecution',true),updated_at=now() where task_id=v_paint_task and item_key='reset_work_04';

  update atlas.tasks set
    title='Paint · 2 exterior house doors · purple · coat 1',
    metadata=(coalesce(metadata,'{}'::jsonb)
      -'execution_do'-'execution_how'-'execution_done_when'-'display_detail'-'venue_reset_ready_label'-'venue_reset_ready_result'-'owner_rescheduled_reason')
      ||jsonb_build_object('display_action','Paint','display_subject','2 exterior house doors','structured_execution_contract','work_execution_components_v1','prose_retired',true),
    updated_at=now()
  where id=v_paint_task;
  perform atlas.sync_task_execution_components_from_canonical_v1(v_paint_task);

  select planned_occurrence_id into v_occ from atlas.tasks where id=v_paint_task;
  if v_occ is not null then
    update atlas.planned_work_occurrences o set
      title='Paint · 2 exterior house doors · purple · coat 1',
      task_payload=(o.task_payload-'note')||jsonb_build_object(
        'title','Paint · 2 exterior house doors · purple · coat 1',
        'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)-'execution_do'-'execution_how'-'execution_done_when'-'display_detail'-'venue_reset_ready_label'-'venue_reset_ready_result'-'owner_rescheduled_reason')
          ||jsonb_build_object('display_action','Paint','display_subject','2 exterior house doors','structured_execution_contract','work_execution_components_v1','prose_retired',true)
      ),
      metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
      updated_at=now()
    where id=v_occ;
  end if;
end;
$migration$;