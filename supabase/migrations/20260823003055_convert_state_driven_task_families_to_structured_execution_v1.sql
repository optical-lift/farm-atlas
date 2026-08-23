do $migration$
declare
  v_farm_id uuid:='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  v_org_id uuid;
  r record;
  v_cycle atlas.crop_cycles%rowtype;
  v_provider text;
  v_service text;
  v_price numeric;
  v_cadence numeric;
begin
  select organization_id into v_org_id from atlas.farms where id=v_farm_id;
  if v_org_id is null then raise exception 'Elm Farm organization missing.'; end if;

  -- Crop-cycle observations: harvest watch + germination. The crop cycle and its object are the instruction.
  for r in
    select o.id,o.released_task_id,o.task_payload,
           nullif(o.task_payload#>>'{metadata,crop_cycle_id}','')::uuid as crop_cycle_id
    from atlas.planned_work_occurrences o
    where o.farm_id=v_farm_id and o.state not in ('completed','cancelled')
      and o.task_payload->>'task_type' in ('harvest_watch','germination_check')
      and nullif(o.task_payload#>>'{metadata,crop_cycle_id}','') is not null
  loop
    select * into v_cycle from atlas.crop_cycles where id=r.crop_cycle_id;
    if v_cycle.id is null then continue; end if;

    insert into atlas.work_execution_components(
      organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,
      reference_kind,reference_id,object_id,required,sort_order,source
    ) values
      (v_org_id,v_farm_id,r.id,'crop_cycle','crop_cycle','observe',coalesce(nullif(trim(concat_ws(' · ',v_cycle.crop_label,v_cycle.variety)),''),'Crop cycle'),'crop_cycle',v_cycle.id,null,true,10,'state_driven_family_v1'),
      (v_org_id,v_farm_id,r.id,'crop_place','object','target',coalesce((select label from atlas.growing_objects where id=v_cycle.object_id),'Crop place'),'growing_object',v_cycle.object_id,v_cycle.object_id,true,20,'state_driven_family_v1')
    on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
      component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
      reference_kind=excluded.reference_kind,reference_id=excluded.reference_id,object_id=excluded.object_id,
      required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    insert into atlas.work_execution_relations(
      organization_id,farm_id,planned_occurrence_id,relation_key,relation_kind,from_component_key,to_component_key,sort_order,source
    ) values(v_org_id,v_farm_id,r.id,'crop_at_place','at','crop_cycle','crop_place',10,'state_driven_family_v1')
    on conflict (planned_occurrence_id,relation_key) where planned_occurrence_id is not null do update set
      relation_kind=excluded.relation_kind,from_component_key=excluded.from_component_key,to_component_key=excluded.to_component_key,
      sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    update atlas.planned_work_occurrences o
    set task_payload=(o.task_payload-'note')||jsonb_build_object(
          'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)
            -'display_detail'-'owner_release_reason'-'sunday_guardrail_reason')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1')
        ),
        metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
        updated_at=now()
    where o.id=r.id;

    if r.released_task_id is not null then
      update atlas.tasks t set note=null,
        metadata=(coalesce(t.metadata,'{}'::jsonb)-'display_detail'-'owner_release_reason'-'sunday_guardrail_reason')
          ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),updated_at=now()
      where t.id=r.released_task_id and t.status in ('open','blocked','in_progress');
      perform atlas.copy_work_execution_structure_to_task_v1(r.id,r.released_task_id);
      perform atlas.sync_task_execution_components_from_canonical_v1(r.released_task_id);
    end if;
  end loop;

  -- Rhythm work: rhythm state + existing canonical object/resource links + numeric parameters replace narration.
  for r in
    select o.id,o.released_task_id,o.task_payload,
           nullif(o.task_payload#>>'{metadata,rhythm_state_id}','')::uuid as rhythm_state_id
    from atlas.planned_work_occurrences o
    where o.farm_id=v_farm_id and o.state not in ('completed','cancelled')
      and o.task_payload#>>'{metadata,rhythm_state_id}' is not null
      and o.task_payload->>'action_key' in ('mow','weed')
  loop
    insert into atlas.work_execution_components(
      organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,
      reference_kind,reference_id,required,sort_order,source
    ) values(v_org_id,v_farm_id,r.id,'rhythm_state','state','governs','Rhythm','rhythm_state',r.rhythm_state_id,true,5,'state_driven_family_v1')
    on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
      reference_id=excluded.reference_id,required=excluded.required,source=excluded.source,updated_at=now();

    if nullif(r.task_payload#>>'{metadata,target_cut_height_inches}','') is not null then
      insert into atlas.work_execution_components(
        organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,value_numeric,unit,required,sort_order,source
      ) values(v_org_id,v_farm_id,r.id,'cut_height','parameter','cut_height','Cut height',(r.task_payload#>>'{metadata,target_cut_height_inches}')::numeric,'in',true,40,'state_driven_family_v1')
      on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
        value_numeric=excluded.value_numeric,unit=excluded.unit,source=excluded.source,updated_at=now();
    end if;

    update atlas.planned_work_occurrences o
    set task_payload=(o.task_payload-'note')||jsonb_build_object(
          'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)
            -'cut_height_label'-'display_detail'-'priority_reasons'-'owner_reschedule_reason'-'work_class_correction_reason')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1')
        ),
        metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
        updated_at=now()
    where o.id=r.id;

    if r.released_task_id is not null then
      update atlas.tasks t set note=null,
        metadata=(coalesce(t.metadata,'{}'::jsonb)-'cut_height_label'-'display_detail'-'priority_reasons'-'owner_reschedule_reason'-'work_class_correction_reason')
          ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),updated_at=now()
      where t.id=r.released_task_id and t.status in ('open','blocked','in_progress');
      perform atlas.copy_work_execution_structure_to_task_v1(r.id,r.released_task_id);
      perform atlas.sync_task_execution_components_from_canonical_v1(r.released_task_id);
    end if;
  end loop;

  -- Contractor service checks: provider/service/cadence/price/date are the card; explanatory sentences are not.
  for r in
    select o.id,o.released_task_id,o.task_payload
    from atlas.planned_work_occurrences o
    where o.farm_id=v_farm_id and o.state not in ('completed','cancelled')
      and o.task_payload->>'task_type'='contractor_service_status'
  loop
    v_provider:=coalesce(nullif(r.task_payload#>>'{metadata,collection_label}',''),nullif(r.task_payload#>>'{metadata,provider_key}',''),'Contractor');
    v_service:=coalesce(nullif(r.task_payload#>>'{metadata,service_type}',''),'Service');
    begin v_price:=(r.task_payload#>>'{metadata,price_per_visit}')::numeric; exception when others then v_price:=null; end;
    begin v_cadence:=(r.task_payload#>>'{metadata,cadence_days}')::numeric; exception when others then v_cadence:=null; end;

    insert into atlas.work_execution_components(
      organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,value_text,value_numeric,unit,required,sort_order,source
    ) values
      (v_org_id,v_farm_id,r.id,'provider','party','provider',v_provider,null,null,null,true,10,'contractor_family_v1'),
      (v_org_id,v_farm_id,r.id,'service','service','target',replace(initcap(replace(v_service,'_',' ')),'  ',' '),v_service,null,null,true,20,'contractor_family_v1'),
      (v_org_id,v_farm_id,r.id,'cadence','parameter','cadence','Cadence',null,v_cadence,'days',v_cadence is not null,30,'contractor_family_v1'),
      (v_org_id,v_farm_id,r.id,'price','parameter','price','Price',null,v_price,coalesce(nullif(r.task_payload#>>'{metadata,currency}',''),'USD'),v_price is not null,40,'contractor_family_v1')
    on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
      component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
      value_text=excluded.value_text,value_numeric=excluded.value_numeric,unit=excluded.unit,required=excluded.required,
      sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

    update atlas.planned_work_occurrences o
    set task_payload=(o.task_payload-'note')||jsonb_build_object(
          'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)
            -'display_detail'-'status_question'-'next_task_policy')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1')
        ),
        metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
        updated_at=now()
    where o.id=r.id;

    if r.released_task_id is not null then
      update atlas.tasks t set note=null,
        metadata=(coalesce(t.metadata,'{}'::jsonb)-'display_detail'-'status_question'-'next_task_policy')
          ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),updated_at=now()
      where t.id=r.released_task_id and t.status in ('open','blocked','in_progress');
      perform atlas.copy_work_execution_structure_to_task_v1(r.id,r.released_task_id);
    end if;
  end loop;
end;
$migration$;