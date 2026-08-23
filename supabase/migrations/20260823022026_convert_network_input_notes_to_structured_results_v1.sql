with candidates as (
  select t.id,t.farm_id,t.planned_occurrence_id,f.organization_id,
         t.metadata->>'network_input_key' as input_key,
         coalesce(nullif(t.metadata->>'network_input_label',''),regexp_replace(t.title,'^Checklist\s+—\s+','','i')) as input_label
  from atlas.tasks t
  join atlas.farms f on f.id=t.farm_id
  where t.status not in ('done','archived','skipped')
    and t.task_type='checklist_step'
    and nullif(t.metadata->>'network_input_key','') is not null
    and nullif(t.metadata->>'network_log_prompt','') is not null
    and coalesce(t.metadata->>'result_storage','')=''
)
insert into atlas.work_execution_components(
  organization_id,farm_id,task_id,component_key,component_kind,component_role,label,required,sort_order,source,metadata
)
select organization_id,farm_id,id,'input:'||input_key,'material_category','target',input_label,true,10,'network_input_structured_result_v1','{}'::jsonb
from candidates
on conflict (task_id,component_key) where task_id is not null do update set
  component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
  required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

with candidates as (
  select t.farm_id,t.planned_occurrence_id,f.organization_id,
         t.metadata->>'network_input_key' as input_key,
         coalesce(nullif(t.metadata->>'network_input_label',''),regexp_replace(t.title,'^Checklist\s+—\s+','','i')) as input_label
  from atlas.tasks t
  join atlas.farms f on f.id=t.farm_id
  where t.status not in ('done','archived','skipped')
    and t.task_type='checklist_step'
    and t.planned_occurrence_id is not null
    and nullif(t.metadata->>'network_input_key','') is not null
    and nullif(t.metadata->>'network_log_prompt','') is not null
    and coalesce(t.metadata->>'result_storage','')=''
)
insert into atlas.work_execution_components(
  organization_id,farm_id,planned_occurrence_id,component_key,component_kind,component_role,label,required,sort_order,source,metadata
)
select organization_id,farm_id,planned_occurrence_id,'input:'||input_key,'material_category','target',input_label,true,10,'network_input_structured_result_v1','{}'::jsonb
from candidates
on conflict (planned_occurrence_id,component_key) where planned_occurrence_id is not null do update set
  component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
  required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

with candidates as (
  select t.id,t.farm_id,t.planned_occurrence_id,f.organization_id
  from atlas.tasks t
  join atlas.farms f on f.id=t.farm_id
  where t.status not in ('done','archived','skipped')
    and t.task_type='checklist_step'
    and nullif(t.metadata->>'network_input_key','') is not null
    and nullif(t.metadata->>'network_log_prompt','') is not null
    and coalesce(t.metadata->>'result_storage','')=''
), fields(field_key,label,value_kind,unit,required,choices,sort_order) as (
  values
    ('source','Source','text',null,true,'[]'::jsonb,10),
    ('material','Material','text',null,true,'[]'::jsonb,20),
    ('cost','Cost','number','USD',false,'[]'::jsonb,30),
    ('quantity','Quantity','number',null,false,'[]'::jsonb,40),
    ('quantity_unit','Unit','text',null,false,'[]'::jsonb,50),
    ('frequency','Frequency','choice',null,false,'["one_time","daily","weekly","monthly","seasonal","ongoing","unknown"]'::jsonb,60),
    ('fulfillment','Pickup / delivery','choice',null,false,'["pickup","delivery","both","unknown"]'::jsonb,70),
    ('eligibility','Eligibility','choice',null,false,'["eligible","maybe","not_eligible","unknown"]'::jsonb,80),
    ('availability','Availability','choice',null,false,'["available_now","periodic","future","unavailable","unknown"]'::jsonb,90),
    ('contact','Contact','text',null,false,'[]'::jsonb,100)
)
insert into atlas.work_result_fields(
  organization_id,farm_id,task_id,field_key,label,value_kind,unit,required,choices,sort_order,source,metadata
)
select c.organization_id,c.farm_id,c.id,f.field_key,f.label,f.value_kind,f.unit,f.required,f.choices,f.sort_order,'network_input_structured_result_v1','{}'::jsonb
from candidates c cross join fields f
on conflict (task_id,field_key) where task_id is not null do update set
  label=excluded.label,value_kind=excluded.value_kind,unit=excluded.unit,required=excluded.required,
  choices=excluded.choices,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

with candidates as (
  select t.farm_id,t.planned_occurrence_id,f.organization_id
  from atlas.tasks t
  join atlas.farms f on f.id=t.farm_id
  where t.status not in ('done','archived','skipped')
    and t.task_type='checklist_step'
    and t.planned_occurrence_id is not null
    and nullif(t.metadata->>'network_input_key','') is not null
    and nullif(t.metadata->>'network_log_prompt','') is not null
    and coalesce(t.metadata->>'result_storage','')=''
), fields(field_key,label,value_kind,unit,required,choices,sort_order) as (
  values
    ('source','Source','text',null,true,'[]'::jsonb,10),
    ('material','Material','text',null,true,'[]'::jsonb,20),
    ('cost','Cost','number','USD',false,'[]'::jsonb,30),
    ('quantity','Quantity','number',null,false,'[]'::jsonb,40),
    ('quantity_unit','Unit','text',null,false,'[]'::jsonb,50),
    ('frequency','Frequency','choice',null,false,'["one_time","daily","weekly","monthly","seasonal","ongoing","unknown"]'::jsonb,60),
    ('fulfillment','Pickup / delivery','choice',null,false,'["pickup","delivery","both","unknown"]'::jsonb,70),
    ('eligibility','Eligibility','choice',null,false,'["eligible","maybe","not_eligible","unknown"]'::jsonb,80),
    ('availability','Availability','choice',null,false,'["available_now","periodic","future","unavailable","unknown"]'::jsonb,90),
    ('contact','Contact','text',null,false,'[]'::jsonb,100)
)
insert into atlas.work_result_fields(
  organization_id,farm_id,planned_occurrence_id,field_key,label,value_kind,unit,required,choices,sort_order,source,metadata
)
select c.organization_id,c.farm_id,c.planned_occurrence_id,f.field_key,f.label,f.value_kind,f.unit,f.required,f.choices,f.sort_order,'network_input_structured_result_v1','{}'::jsonb
from candidates c cross join fields f
on conflict (planned_occurrence_id,field_key) where planned_occurrence_id is not null do update set
  label=excluded.label,value_kind=excluded.value_kind,unit=excluded.unit,required=excluded.required,
  choices=excluded.choices,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

update atlas.tasks
set note=null,
    metadata=(coalesce(metadata,'{}'::jsonb)-'network_log_prompt')||jsonb_build_object(
      'result_contract','structured_work_result_v1',
      'result_storage','atlas.work_result_submissions'
    ),
    updated_at=now()
where status not in ('done','archived','skipped')
  and task_type='checklist_step'
  and nullif(metadata->>'network_input_key','') is not null
  and nullif(metadata->>'network_log_prompt','') is not null
  and coalesce(metadata->>'result_storage','')='';

update atlas.tasks
set metadata=(coalesce(metadata,'{}'::jsonb)-'network_log_prompt')||jsonb_build_object('result_contract','network_outreach_v1'),
    updated_at=now()
where status not in ('done','archived','skipped')
  and task_type='checklist_step'
  and nullif(metadata->>'network_log_prompt','') is not null
  and coalesce(metadata->>'result_storage','')='task_note_and_network_outreach_result';