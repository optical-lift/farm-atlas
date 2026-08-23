do $migration$
declare
  v_farm_id uuid:='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  v_org_id uuid;
  r record;
  v_target text;
  v_phone text;
  v_email text;
  v_address text;
  v_contact text;
  v_occ_id uuid;
  v_downstream uuid;
  v_vase_count numeric;
  v_weekly_price numeric;
  v_extra_price numeric;
begin
  select organization_id into v_org_id from atlas.farms where id=v_farm_id;
  if v_org_id is null then raise exception 'Elm Farm organization missing.'; end if;

  -- Turn serial next-batch prose into real dependencies.
  for r in
    select t.id,t.metadata->>'next_batch_task_key' next_key
    from atlas.tasks t
    where t.farm_id=v_farm_id and t.status in ('open','blocked','in_progress')
      and nullif(t.metadata->>'next_batch_task_key','') is not null
  loop
    select id into v_downstream from atlas.tasks
    where farm_id=v_farm_id and metadata->>'task_key'=r.next_key
    order by created_at desc limit 1;
    if v_downstream is not null and v_downstream<>r.id then
      insert into atlas.task_prerequisites(farm_id,downstream_task_id,prerequisite_task_id,required_status,hold_mode,sequence_order,active,metadata)
      values(v_farm_id,v_downstream,r.id,'done','deferred_hidden',1,true,jsonb_build_object('source','next_batch_task_key','structuredExecution',true))
      on conflict(downstream_task_id,prerequisite_task_id) do update set required_status='done',hold_mode='deferred_hidden',active=true,updated_at=now();
    end if;
  end loop;

  for r in
    select t.*
    from atlas.tasks t
    where t.farm_id=v_farm_id and t.status in ('open','blocked','in_progress')
      and t.task_type in ('network_outreach','network_outreach_contact','community_outreach','network')
  loop
    v_target:=coalesce(nullif(r.metadata->>'business_name',''),nullif(r.metadata->>'church_name',''),nullif(r.metadata->>'location_name',''),nullif(r.metadata->>'suggested_group',''),nullif(r.metadata->>'display_subject',''),r.title);
    v_phone:=coalesce(nullif(r.metadata->>'business_phone',''),nullif(r.metadata->>'church_phone',''),nullif(r.metadata->>'phone_number',''));
    v_email:=coalesce(nullif(r.metadata->>'business_email',''),nullif(r.metadata->>'church_email',''));
    v_address:=coalesce(nullif(r.metadata->>'business_address',''),nullif(r.metadata->>'address',''));
    v_contact:=coalesce(nullif(r.metadata->>'known_contact_name',''),nullif(r.metadata->>'suggested_contact',''));
    v_occ_id:=r.planned_occurrence_id;

    insert into atlas.work_execution_components(
      organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_text,required,sort_order,source
    ) values(v_org_id,v_farm_id,r.id,'target','party','target',v_target,null,true,10,'network_structured_v1')
    on conflict (task_id,component_key) where task_id is not null do update set label=excluded.label,source=excluded.source,updated_at=now();

    if v_phone is not null then
      insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_text,required,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'phone','contact','phone','Phone',v_phone,true,20,'network_structured_v1')
      on conflict (task_id,component_key) where task_id is not null do update set value_text=excluded.value_text,source=excluded.source,updated_at=now();
      insert into atlas.work_execution_relations(organization_id,farm_id,task_id,relation_key,relation_kind,from_component_key,to_component_key,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'phone_for_target','for','phone','target',20,'network_structured_v1')
      on conflict (task_id,relation_key) where task_id is not null do update set relation_kind=excluded.relation_kind,source=excluded.source,updated_at=now();
    end if;
    if v_email is not null then
      insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_text,required,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'email','contact','email','Email',v_email,false,21,'network_structured_v1')
      on conflict (task_id,component_key) where task_id is not null do update set value_text=excluded.value_text,source=excluded.source,updated_at=now();
      insert into atlas.work_execution_relations(organization_id,farm_id,task_id,relation_key,relation_kind,from_component_key,to_component_key,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'email_for_target','for','email','target',21,'network_structured_v1')
      on conflict (task_id,relation_key) where task_id is not null do update set relation_kind=excluded.relation_kind,source=excluded.source,updated_at=now();
    end if;
    if v_address is not null then
      insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_text,required,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'address','place','address','Address',v_address,false,22,'network_structured_v1')
      on conflict (task_id,component_key) where task_id is not null do update set value_text=excluded.value_text,source=excluded.source,updated_at=now();
      insert into atlas.work_execution_relations(organization_id,farm_id,task_id,relation_key,relation_kind,from_component_key,to_component_key,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'address_for_target','for','address','target',22,'network_structured_v1')
      on conflict (task_id,relation_key) where task_id is not null do update set relation_kind=excluded.relation_kind,source=excluded.source,updated_at=now();
    end if;
    if v_contact is not null then
      insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_text,required,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'contact_person','party','contact','Contact',v_contact,false,23,'network_structured_v1')
      on conflict (task_id,component_key) where task_id is not null do update set value_text=excluded.value_text,source=excluded.source,updated_at=now();
      insert into atlas.work_execution_relations(organization_id,farm_id,task_id,relation_key,relation_kind,from_component_key,to_component_key,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'contact_for_target','for','contact_person','target',23,'network_structured_v1')
      on conflict (task_id,relation_key) where task_id is not null do update set relation_kind=excluded.relation_kind,source=excluded.source,updated_at=now();
    end if;

    if nullif(r.metadata->>'sales_channel','') is not null then
      insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_text,required,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'sales_channel','channel','sales',replace(initcap(replace(r.metadata->>'sales_channel','_',' ')),'  ',' '),r.metadata->>'sales_channel',true,30,'network_structured_v1')
      on conflict (task_id,component_key) where task_id is not null do update set label=excluded.label,value_text=excluded.value_text,source=excluded.source,updated_at=now();
    end if;
    if nullif(r.metadata->>'buyer_relationship_stable_key','') is not null then
      insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_text,required,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'buyer_relationship','identifier','buyer_relationship','Buyer relationship',r.metadata->>'buyer_relationship_stable_key',false,31,'network_structured_v1')
      on conflict (task_id,component_key) where task_id is not null do update set value_text=excluded.value_text,source=excluded.source,updated_at=now();
    end if;
    if nullif(r.metadata->>'parent_task_id','') is not null then
      insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,reference_kind,reference_id,required,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'parent_batch','task','parent','Outreach batch','task',(r.metadata->>'parent_task_id')::uuid,true,5,'network_structured_v1')
      on conflict (task_id,component_key) where task_id is not null do update set reference_id=excluded.reference_id,source=excluded.source,updated_at=now();
    end if;

    -- Restaurant offer: facts, not a speech.
    if r.metadata ? 'default_offer' then
      begin v_vase_count:=(r.metadata#>>'{default_offer,vase_count}')::numeric; exception when others then v_vase_count:=null; end;
      begin v_weekly_price:=(r.metadata#>>'{default_offer,weekly_price_dollars}')::numeric; exception when others then v_weekly_price:=null; end;
      begin v_extra_price:=(r.metadata#>>'{default_offer,additional_vase_price_dollars}')::numeric; exception when others then v_extra_price:=null; end;
      if v_vase_count is not null then
        insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_numeric,unit,required,sort_order,source)
        values(v_org_id,v_farm_id,r.id,'offer_vases','quantity','offer','Bud vases',v_vase_count,'vases',true,40,'network_structured_v1')
        on conflict (task_id,component_key) where task_id is not null do update set value_numeric=excluded.value_numeric,unit=excluded.unit,source=excluded.source,updated_at=now();
      end if;
      if v_weekly_price is not null then
        insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_numeric,unit,required,sort_order,source)
        values(v_org_id,v_farm_id,r.id,'offer_price','price','weekly_price','Weekly price',v_weekly_price,'USD/week',true,41,'network_structured_v1')
        on conflict (task_id,component_key) where task_id is not null do update set value_numeric=excluded.value_numeric,unit=excluded.unit,source=excluded.source,updated_at=now();
      end if;
      if v_extra_price is not null then
        insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_numeric,unit,required,sort_order,source)
        values(v_org_id,v_farm_id,r.id,'additional_vase_price','price','additional_unit','Additional vase',v_extra_price,'USD',false,42,'network_structured_v1')
        on conflict (task_id,component_key) where task_id is not null do update set value_numeric=excluded.value_numeric,unit=excluded.unit,source=excluded.source,updated_at=now();
      end if;
      insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_text,required,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'delivery_day','schedule','delivery_day','Wednesday','Wednesday',true,43,'network_structured_v1')
      on conflict (task_id,component_key) where task_id is not null do update set value_text=excluded.value_text,source=excluded.source,updated_at=now();
      insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_text,required,sort_order,source)
      values(v_org_id,v_farm_id,r.id,'vase_cycle','flow','return_cycle','Swap prior vases','swap_previous_12',true,44,'network_structured_v1')
      on conflict (task_id,component_key) where task_id is not null do update set value_text=excluded.value_text,source=excluded.source,updated_at=now();
    end if;

    -- Price Cutter research: exact result slots replace nine narrated questions.
    if r.metadata->>'task_key'='anna_price_cutter_nixa_vendor_path' then
      insert into atlas.work_execution_components(organization_id,farm_id,task_id,component_key,component_kind,component_role,label,required,sort_order,source)
      values
        (v_org_id,v_farm_id,r.id,'application_path','result_field','capture','Application path',true,50,'network_structured_v1'),
        (v_org_id,v_farm_id,r.id,'buyer_contact','result_field','capture','Buyer / vendor contact',true,51,'network_structured_v1'),
        (v_org_id,v_farm_id,r.id,'packaging','result_field','capture','Packaging',false,52,'network_structured_v1'),
        (v_org_id,v_farm_id,r.id,'pricing','result_field','capture','Pricing',false,53,'network_structured_v1'),
        (v_org_id,v_farm_id,r.id,'delivery','result_field','capture','Delivery',false,54,'network_structured_v1'),
        (v_org_id,v_farm_id,r.id,'invoicing','result_field','capture','Invoicing',false,55,'network_structured_v1'),
        (v_org_id,v_farm_id,r.id,'insurance_certification','result_field','capture','Insurance / certification',false,56,'network_structured_v1'),
        (v_org_id,v_farm_id,r.id,'labeling','result_field','capture','Labeling',false,57,'network_structured_v1'),
        (v_org_id,v_farm_id,r.id,'minimum_volume','result_field','capture','Minimum volume',false,58,'network_structured_v1')
      on conflict (task_id,component_key) where task_id is not null do update set label=excluded.label,required=excluded.required,source=excluded.source,updated_at=now();
    end if;

    -- Remove authored narration. Structured result objects and append-only contact events remain untouched.
    update atlas.tasks t set
      note=null,
      blocker_text=case
        when exists(select 1 from atlas.task_prerequisites p where p.downstream_task_id=t.id and p.active=true)
          or nullif(t.metadata->>'sales_inventory_gate_state','') is not null
          or nullif(t.metadata->>'crop_availability_gate_state','') is not null
          or nullif(t.metadata->>'reality_gate_state','') is not null
          or nullif(t.metadata->>'network_owner_confirmation_state','') is not null
          or nullif(t.metadata->>'parent_task_id','') is not null
          or t.metadata->>'outreach_release_state' in ('queued','waiting_for_inventory','waiting')
          or t.metadata->>'checklist_status'='blocked'
        then null else t.blocker_text end,
      title=case
        when t.metadata->>'task_key'='anna_price_cutter_nixa_vendor_path' then 'Nixa Price Cutter · local flower vendor path'
        when t.metadata->>'task_key'='owner_webster_library_display_thursdays_poster' then 'Webster County Library · Thursdays at Elm poster'
        else t.title end,
      metadata=(coalesce(t.metadata,'{}'::jsonb)
        -'execution_do'-'execution_how'-'execution_done_when'-'outreach_script'-'voicemail_script'-'if_they_ask'
        -'network_log_prompt'-'sales_instruction'-'elm_sales_philosophy'-'callback_note'-'worker_result_label'-'worker_result_lines'
        -'worker_execution_scope_reason'-'archived_reason'-'false_completion_reason'-'schedule_adjustment_reason'
        -'owner_schedule_override_reason'-'prerequisite_gate_restore'-'network_owner_confirmation_restore')
        ||case when t.metadata ? 'default_offer' then jsonb_build_object('default_offer',jsonb_strip_nulls(jsonb_build_object(
            'offer_key',t.metadata->>'offer_key',
            'vase_count',t.metadata#>'{default_offer,vase_count}',
            'delivery_day',t.metadata#>'{default_offer,delivery_day}',
            'pause_allowed',t.metadata#>'{default_offer,pause_allowed}',
            'vase_cycle','swap_previous_12',
            'vase_ownership','elm_farm',
            'stems_per_vase_min',2,
            'stems_per_vase_max',4,
            'contract_required',t.metadata#>'{default_offer,contract_required}',
            'weekly_price_dollars',t.metadata#>'{default_offer,weekly_price_dollars}',
            'additional_vase_price_dollars',t.metadata#>'{default_offer,additional_vase_price_dollars}'
          ))) else '{}'::jsonb end
        ||jsonb_build_object('structured_execution_contract','work_execution_components_v1','prose_retired',true),
      updated_at=now()
    where t.id=r.id;

    if v_occ_id is not null then
      insert into atlas.work_execution_components(
        organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,
        value_text,value_numeric,value_boolean,unit,reference_kind,reference_id,resource_id,object_id,zone_id,required,sort_order,source,metadata
      )
      select organization_id,farm_id,v_occ_id,component_key,component_kind,component_role,label,
             value_text,value_numeric,value_boolean,unit,reference_kind,reference_id,resource_id,object_id,zone_id,required,sort_order,'network_structured_v1',metadata
      from atlas.work_execution_components where task_id=r.id and source='network_structured_v1'
      on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
        component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
        value_text=excluded.value_text,value_numeric=excluded.value_numeric,value_boolean=excluded.value_boolean,unit=excluded.unit,
        reference_kind=excluded.reference_kind,reference_id=excluded.reference_id,resource_id=excluded.resource_id,object_id=excluded.object_id,zone_id=excluded.zone_id,
        required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,metadata=excluded.metadata,updated_at=now();

      insert into atlas.work_execution_relations(
        organization_id,farm_id,planned_occurrence_id,relation_key,relation_kind,from_component_key,to_component_key,condition_component_key,required,sort_order,source,metadata
      )
      select organization_id,farm_id,v_occ_id,relation_key,relation_kind,from_component_key,to_component_key,condition_component_key,required,sort_order,'network_structured_v1',metadata
      from atlas.work_execution_relations where task_id=r.id and source='network_structured_v1'
      on conflict (planned_occurrence_id,relation_key) where planned_occurrence_id is not null do update set
        relation_kind=excluded.relation_kind,from_component_key=excluded.from_component_key,to_component_key=excluded.to_component_key,
        condition_component_key=excluded.condition_component_key,required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,metadata=excluded.metadata,updated_at=now();

      update atlas.planned_work_occurrences o set
        title=case
          when r.metadata->>'task_key'='anna_price_cutter_nixa_vendor_path' then 'Nixa Price Cutter · local flower vendor path'
          when r.metadata->>'task_key'='owner_webster_library_display_thursdays_poster' then 'Webster County Library · Thursdays at Elm poster'
          else o.title end,
        task_payload=(o.task_payload-'note'-'blocker_text')||jsonb_build_object(
          'title',case
            when r.metadata->>'task_key'='anna_price_cutter_nixa_vendor_path' then 'Nixa Price Cutter · local flower vendor path'
            when r.metadata->>'task_key'='owner_webster_library_display_thursdays_poster' then 'Webster County Library · Thursdays at Elm poster'
            else coalesce(o.task_payload->>'title',o.title) end,
          'metadata',(coalesce(o.task_payload->'metadata','{}'::jsonb)
            -'execution_do'-'execution_how'-'execution_done_when'-'outreach_script'-'voicemail_script'-'if_they_ask'
            -'network_log_prompt'-'sales_instruction'-'elm_sales_philosophy'-'callback_note'-'worker_result_label'-'worker_result_lines'
            -'worker_execution_scope_reason'-'archived_reason'-'false_completion_reason'-'schedule_adjustment_reason'
            -'owner_schedule_override_reason'-'prerequisite_gate_restore'-'network_owner_confirmation_restore')
            ||jsonb_build_object('structured_execution_contract','work_execution_components_v1')
        ),
        metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('structuredExecutionContract','work_execution_components_v1','proseRetired',true),
        updated_at=now()
      where o.id=v_occ_id;
    end if;
  end loop;
end;
$migration$;