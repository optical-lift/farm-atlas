update atlas.tasks
set status='archived',
    note=null,
    blocker_text=null,
    metadata=(coalesce(metadata,'{}'::jsonb)
      - 'removed_from_owner_work_feed_reason')
      || jsonb_build_object(
        'semantic_container_state','retired_non_executable',
        'semantic_container_retired_source','structured_work_no_prose_v1'
      ),
    updated_at=now()
where status not in ('done','archived','skipped')
  and coalesce((metadata->>'project_tracking_only')::boolean,false)
  and coalesce(note,'') ilike 'Project-state tracker%';

with candidates as (
  select t.id,t.farm_id,f.organization_id,
         coalesce(nullif(t.metadata->>'display_subject',''),nullif(t.metadata->>'crop_label',''),t.title) as subject,
         nullif(t.metadata->>'source_crop_cycle_id','')::uuid as crop_cycle_id
  from atlas.tasks t
  join atlas.farms f on f.id=t.farm_id
  where t.status not in ('done','archived','skipped')
    and t.task_type='spatial_destination_resolution'
    and coalesce((t.metadata->>'destination_claim_required')::boolean,true)
)
insert into atlas.work_execution_components(
  organization_id,farm_id,task_id,component_key,component_kind,component_role,label,
  value_text,required,sort_order,source,metadata
)
select organization_id,farm_id,id,'state:destination','state','destination','Destination',
       'missing',true,1,'destination_truth_v1',jsonb_build_object('subject',subject,'cropCycleId',crop_cycle_id)
from candidates
on conflict (task_id,component_key) where task_id is not null do update set
  component_kind=excluded.component_kind,
  component_role=excluded.component_role,
  label=excluded.label,
  value_text=excluded.value_text,
  required=excluded.required,
  sort_order=excluded.sort_order,
  source=excluded.source,
  metadata=excluded.metadata,
  updated_at=now();

with candidates as (
  select t.id,t.farm_id,f.organization_id,
         nullif(t.metadata->>'source_crop_cycle_id','')::uuid as crop_cycle_id
  from atlas.tasks t
  join atlas.farms f on f.id=t.farm_id
  where t.status not in ('done','archived','skipped')
    and t.task_type='spatial_destination_resolution'
    and coalesce((t.metadata->>'destination_claim_required')::boolean,true)
    and nullif(t.metadata->>'source_crop_cycle_id','') is not null
)
insert into atlas.work_execution_relations(
  organization_id,farm_id,task_id,relation_key,relation_kind,from_component_key,to_component_key,
  required,sort_order,source,metadata
)
select organization_id,farm_id,id,'crop_cycle_requires_destination','requires',
       'crop_cycle:'||crop_cycle_id::text||':prerequisite','state:destination',true,1,'destination_truth_v1','{}'::jsonb
from candidates
on conflict (task_id,relation_key) where task_id is not null do update set
  relation_kind=excluded.relation_kind,
  from_component_key=excluded.from_component_key,
  to_component_key=excluded.to_component_key,
  required=excluded.required,
  sort_order=excluded.sort_order,
  source=excluded.source,
  updated_at=now();

update atlas.tasks
set title='Destination · '||coalesce(nullif(metadata->>'display_subject',''),nullif(metadata->>'crop_label',''),title),
    note=null,
    blocker_text=null,
    metadata=(coalesce(metadata,'{}'::jsonb)
      - 'display_detail'
      - 'resolution_reason'
      - 'execution_statement'
      - 'requirement_statement'
      - 'missing_truth_statement')
      || jsonb_build_object(
        'display_action','Destination',
        'destination_state','missing',
        'structured_truth_contract','crop_destination_claim_v1'
      ),
    updated_at=now()
where status not in ('done','archived','skipped')
  and task_type='spatial_destination_resolution'
  and coalesce((metadata->>'destination_claim_required')::boolean,true);