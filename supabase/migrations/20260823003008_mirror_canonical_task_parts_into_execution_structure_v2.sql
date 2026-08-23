create or replace function atlas.sync_task_execution_components_from_canonical_v1(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_org_id uuid;
  v_count integer:=0;
  v_cut numeric;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then return jsonb_build_object('state','task_missing','taskId',p_task_id); end if;
  select organization_id into v_org_id from atlas.farms where id=v_task.farm_id;
  if v_org_id is null then return jsonb_build_object('state','organization_missing','taskId',p_task_id); end if;

  delete from atlas.work_execution_components where task_id=p_task_id and source='canonical_mirror_v1';

  insert into atlas.work_execution_components(
    organization_id,farm_id,task_id,component_key,component_kind,component_role,label,
    reference_kind,reference_id,object_id,required,sort_order,source
  )
  select v_org_id,v_task.farm_id,p_task_id,'object:'||o.object_id::text,'object',coalesce(nullif(o.role,''),'target'),go.label,
         'growing_object',o.object_id,o.object_id,true,20,'canonical_mirror_v1'
  from atlas.task_objects o join atlas.growing_objects go on go.id=o.object_id
  where o.task_id=p_task_id
  on conflict (task_id,component_key) where task_id is not null do update set
    component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
    reference_kind=excluded.reference_kind,reference_id=excluded.reference_id,object_id=excluded.object_id,
    required=excluded.required,sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

  insert into atlas.work_execution_components(
    organization_id,farm_id,task_id,component_key,component_kind,component_role,label,
    value_numeric,unit,reference_kind,reference_id,resource_id,required,sort_order,source
  )
  select v_org_id,v_task.farm_id,p_task_id,'resource:'||rr.resource_id::text||':'||rr.requirement_role,
         'resource',rr.requirement_role,r.label,rr.quantity_needed,rr.unit,'resource',rr.resource_id,rr.resource_id,
         rr.requirement_role in ('required','consumed','check_first'),30,'canonical_mirror_v1'
  from atlas.task_resource_requirements rr join atlas.resources r on r.id=rr.resource_id
  where rr.task_id=p_task_id and rr.status<>'waived'
  on conflict (task_id,component_key) where task_id is not null do update set
    component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
    value_numeric=excluded.value_numeric,unit=excluded.unit,reference_kind=excluded.reference_kind,
    reference_id=excluded.reference_id,resource_id=excluded.resource_id,required=excluded.required,
    sort_order=excluded.sort_order,source=excluded.source,updated_at=now();

  insert into atlas.work_execution_components(
    organization_id,farm_id,task_id,component_key,component_kind,component_role,label,
    reference_kind,reference_id,required,sort_order,source,metadata
  )
  select v_org_id,v_task.farm_id,p_task_id,'crop_cycle:'||tc.crop_cycle_id::text||':'||tc.role,
         'crop_cycle',tc.role,coalesce(nullif(trim(concat_ws(' · ',nullif(cc.crop_label,''),nullif(cc.variety,''))),''),'Crop cycle'),
         'crop_cycle',tc.crop_cycle_id,tc.confidence='confirmed',10,'canonical_mirror_v1',
         jsonb_build_object('confidence',tc.confidence,'linkSource',tc.source)
  from atlas.task_crop_cycles tc join atlas.crop_cycles cc on cc.id=tc.crop_cycle_id
  where tc.task_id=p_task_id
  on conflict (task_id,component_key) where task_id is not null do update set
    component_kind=excluded.component_kind,component_role=excluded.component_role,label=excluded.label,
    reference_kind=excluded.reference_kind,reference_id=excluded.reference_id,required=excluded.required,
    sort_order=excluded.sort_order,source=excluded.source,metadata=excluded.metadata,updated_at=now();

  if nullif(v_task.metadata->>'target_cut_height_inches','') is not null then
    begin v_cut:=(v_task.metadata->>'target_cut_height_inches')::numeric; exception when others then v_cut:=null; end;
    if v_cut is not null then
      insert into atlas.work_execution_components(
        organization_id,farm_id,task_id,component_key,component_kind,component_role,label,value_numeric,unit,required,sort_order,source
      ) values(v_org_id,v_task.farm_id,p_task_id,'parameter:cut_height','parameter','cut_height','Cut height',v_cut,'in',true,40,'canonical_mirror_v1')
      on conflict (task_id,component_key) where task_id is not null do update set
        value_numeric=excluded.value_numeric,unit=excluded.unit,required=excluded.required,source=excluded.source,updated_at=now();
    end if;
  end if;

  select count(*) into v_count from atlas.work_execution_components where task_id=p_task_id;
  return jsonb_build_object('state','synced','taskId',p_task_id,'componentCount',v_count);
end;
$function$;

revoke all on function atlas.sync_task_execution_components_from_canonical_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.sync_task_execution_components_from_canonical_v1(uuid) to service_role;

create or replace function atlas.sync_task_execution_components_from_canonical_trigger_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas' as $function$
begin
  perform atlas.sync_task_execution_components_from_canonical_v1(coalesce(new.task_id,old.task_id));
  return coalesce(new,old);
end;
$function$;

drop trigger if exists trg_sync_task_components_from_objects_v1 on atlas.task_objects;
create trigger trg_sync_task_components_from_objects_v1 after insert or update or delete on atlas.task_objects
for each row execute function atlas.sync_task_execution_components_from_canonical_trigger_v1();

drop trigger if exists trg_sync_task_components_from_resources_v1 on atlas.task_resource_requirements;
create trigger trg_sync_task_components_from_resources_v1 after insert or update or delete on atlas.task_resource_requirements
for each row execute function atlas.sync_task_execution_components_from_canonical_trigger_v1();

drop trigger if exists trg_sync_task_components_from_crop_cycles_v1 on atlas.task_crop_cycles;
create trigger trg_sync_task_components_from_crop_cycles_v1 after insert or update or delete on atlas.task_crop_cycles
for each row execute function atlas.sync_task_execution_components_from_canonical_trigger_v1();

create or replace function atlas.sync_task_cut_height_component_trigger_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas' as $function$
begin
  perform atlas.sync_task_execution_components_from_canonical_v1(new.id);
  return new;
end;
$function$;

drop trigger if exists trg_sync_task_cut_height_component_insert_v1 on atlas.tasks;
create trigger trg_sync_task_cut_height_component_insert_v1 after insert on atlas.tasks
for each row when (new.metadata ? 'target_cut_height_inches') execute function atlas.sync_task_cut_height_component_trigger_v1();

drop trigger if exists trg_sync_task_cut_height_component_update_v1 on atlas.tasks;
create trigger trg_sync_task_cut_height_component_update_v1 after update of metadata on atlas.tasks
for each row when ((old.metadata->'target_cut_height_inches') is distinct from (new.metadata->'target_cut_height_inches'))
execute function atlas.sync_task_cut_height_component_trigger_v1();

do $backfill$
declare r record;
begin
  for r in select id from atlas.tasks where status in ('open','blocked','in_progress') loop
    perform atlas.sync_task_execution_components_from_canonical_v1(r.id);
  end loop;
end;
$backfill$;