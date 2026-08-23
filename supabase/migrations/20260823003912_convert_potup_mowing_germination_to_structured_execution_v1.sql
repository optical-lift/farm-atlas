do $migration$
declare
  v_farm_id uuid:='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  v_org_id uuid;
  r record;
  v_place text;
  v_occ uuid;
  v_crop text;
  v_where text;
begin
  select organization_id into v_org_id from atlas.farms where id=v_farm_id;
  if v_org_id is null then raise exception 'Elm Farm organization missing.'; end if;

  -- Sweet William: crop cycles + three real checklist trays are already canonical.
  insert into atlas.work_execution_components(
    organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_numeric,unit,required,sort_order,source
  ) values
    (v_org_id,v_farm_id,'8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid,'tray_count','quantity','container_count','Trays',3,'trays',true,20,'potup_structured_v1'),
    (v_org_id,v_farm_id,'8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid,'tray_size','quantity','per_container','Tray size',200,'cells',true,21,'potup_structured_v1'),
    (v_org_id,v_farm_id,'8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid,'plant_total','quantity','total','Plants',600,'plants',true,22,'potup_structured_v1'),
    (v_org_id,v_farm_id,'8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid,'place','place','work_location','Grow Room',null,null,true,30,'potup_structured_v1')
  on conflict (task_id,component_key) where task_id is not null do update set
    component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
    value_numeric=excluded.value_numeric,unit=excluded.unit,required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

  update atlas.tasks set
    metadata=(coalesce(metadata,'{}'::jsonb)-'execution_do'-'execution_how'-'execution_done_when'-'why_now'-'state_effect'-'display_detail'-'rescheduled_reason'-'classification_correction_reason'-'execution_checklist_completion_label')
      ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),
    updated_at=now()
  where id='8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid;
  perform atlas.sync_task_execution_components_from_canonical_v1('8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid);

  select planned_occurrence_id into v_occ from atlas.tasks where id='8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid;
  if v_occ is not null then
    insert into atlas.work_execution_components(
      organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,value_numeric,unit,required,sort_order,source
    )
    select organization_id,farm_id,v_occ,component_key,component_kind,component_role,label,value_numeric,unit,required,sort_order,'potup_structured_v1'
    from atlas.work_execution_components where task_id='8463ad96-d86e-4c48-a6d0-968bb06e522e'::uuid and source='potup_structured_v1'
    on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
      label=excluded.label,value_numeric=excluded.value_numeric,unit=excluded.unit,required=excluded.required,source=excluded.source,updated_at=now();
    update atlas.planned_work_occurrences o set
      task_payload=jsonb_set(
        o.task_payload,
        '{metadata}',
        (coalesce(o.task_payload->'metadata','{}'::jsonb)-'execution_do'-'execution_how'-'execution_done_when'-'why_now'-'state_effect'-'display_detail'-'rescheduled_reason'-'classification_correction_reason'-'execution_checklist_completion_label')
          ||jsonb_build_object('structured_execution_contract','work_execution_components_v1'),
        true
      )-'note',
      metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
      updated_at=now()
    where o.id=v_occ;
  end if;

  -- Mowing: target/place + mower resource + numeric cut height. No sentence needed.
  for r in
    select t.id,t.planned_occurrence_id,t.title,t.metadata,t.blocker_text
    from atlas.tasks t
    where t.farm_id=v_farm_id and t.status in ('open','blocked','in_progress') and t.action_key='mow'
  loop
    v_place:=coalesce(
      (select string_agg(go.label,' · ' order by go.label) from atlas.task_objects o join atlas.growing_objects go on go.id=o.object_id where o.task_id=r.id),
      nullif(r.metadata->>'execution_place',''),nullif(r.metadata->>'display_location',''),nullif(r.metadata->>'collection_zone',''),r.title
    );
    insert into atlas.work_execution_components(
      organization_id,farm_id,task_id,component_key,component_kind,component_role,label,required,sort_order,source
    ) values(v_org_id,v_farm_id,r.id,'mow_place','place','target',v_place,true,10,'mowing_structured_v1')
    on conflict (task_id,component_key) where task_id is not null do update set label=excluded.label,source=excluded.source,updated_at=now();

    update atlas.tasks t set
      blocker_text=case when exists(select 1 from atlas.task_prerequisites p where p.downstream_task_id=t.id and p.active=true) then null else t.blocker_text end,
      metadata=(coalesce(t.metadata,'{}'::jsonb)-'execution_do'-'execution_how'-'execution_done_when'-'cut_height_label'-'display_detail'-'priority_reasons'-'owner_reschedule_reason'-'work_class_correction_reason')
        ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),
      updated_at=now()
    where t.id=r.id;
    perform atlas.sync_task_execution_components_from_canonical_v1(r.id);

    if r.planned_occurrence_id is not null then
      insert into atlas.work_execution_components(
        organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,
        value_text,value_numeric,value_boolean,unit,reference_kind,reference_id,resource_id,object_id,zone_id,required,sort_order,source,metadata
      )
      select organization_id,farm_id,r.planned_occurrence_id,component_key,component_kind,component_role,label,
             value_text,value_numeric,value_boolean,unit,reference_kind,reference_id,resource_id,object_id,zone_id,required,sort_order,'mowing_structured_v1',metadata
      from atlas.work_execution_components where task_id=r.id
      on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
        component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,value_text=excluded.value_text,
        value_numeric=excluded.value_numeric,value_boolean=excluded.value_boolean,unit=excluded.unit,reference_kind=excluded.reference_kind,
        reference_id=excluded.reference_id,resource_id=excluded.resource_id,object_id=excluded.object_id,zone_id=excluded.zone_id,
        required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,metadata=excluded.metadata,updated_at=now();
      update atlas.planned_work_occurrences o set
        task_payload=(o.task_payload-'note'-'blocker_text')||jsonb_build_object(
          'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)-'execution_do'-'execution_how'-'execution_done_when'-'cut_height_label'-'display_detail'-'priority_reasons'-'owner_reschedule_reason'-'work_class_correction_reason')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1')
        ),
        metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
        updated_at=now()
      where o.id=r.planned_occurrence_id;
    end if;
  end loop;

  -- Germination: crop cycle + place + result instrument. Question/instruction prose is redundant.
  for r in
    select t.id,t.planned_occurrence_id
    from atlas.tasks t
    where t.farm_id=v_farm_id and t.status in ('open','blocked','in_progress') and t.task_type='germination_check'
  loop
    select
      coalesce(nullif(trim(concat_ws(' · ',cc.crop_label,cc.variety)),''),'Crop') as crop,
      go.label as place
    into v_crop,v_where
    from atlas.task_crop_cycles tc
    join atlas.crop_cycles cc on cc.id=tc.crop_cycle_id
    left join atlas.growing_objects go on go.id=cc.object_id
    where tc.task_id=r.id and tc.confidence='confirmed'
    order by case when tc.role='affects' then 0 else 1 end
    limit 1;

    update atlas.tasks set
      title=trim(concat_ws(' · ','Germination',v_crop,v_where)),
      note=null,
      metadata=(coalesce(metadata,'{}'::jsonb)-'execution_do'-'execution_how'-'execution_done_when'-'display_detail'-'owner_release_reason'-'sunday_guardrail_reason')
        ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),
      updated_at=now()
    where id=r.id;
    perform atlas.sync_task_execution_components_from_canonical_v1(r.id);

    if r.planned_occurrence_id is not null then
      update atlas.planned_work_occurrences o set
        title=trim(concat_ws(' · ','Germination',v_crop,v_where)),
        task_payload=(o.task_payload-'note')||jsonb_build_object(
          'title',trim(concat_ws(' · ','Germination',v_crop,v_where)),
          'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)-'execution_do'-'execution_how'-'execution_done_when'-'display_detail'-'owner_release_reason'-'sunday_guardrail_reason')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1')
        ),
        metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
        updated_at=now()
      where o.id=r.planned_occurrence_id;
    end if;
  end loop;
end;
$migration$;