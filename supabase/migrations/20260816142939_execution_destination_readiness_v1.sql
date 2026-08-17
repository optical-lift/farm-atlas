create or replace function atlas.task_execution_destination_readiness_v1(
  p_task_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_task atlas.tasks%rowtype;
  v_zone_key text;
  v_operation text;
  v_type text;
  v_destination_id uuid;
  v_destination_exists boolean:=false;
  v_destination_text text;
  v_state text;
  v_ready boolean;
  v_reason text;
  v_source text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  select z.stable_key into v_zone_key from atlas.zones z where z.id=v_task.zone_id;
  v_operation:=lower(coalesce(v_task.operation_class,''));
  v_type:=lower(coalesce(v_task.task_type,''));
  v_destination_text:=nullif(btrim(coalesce(v_task.metadata->>'transplant_destination',v_task.metadata->>'destination_label',v_task.metadata->>'execution_destination','')),'');

  begin
    v_destination_id:=nullif(coalesce(v_task.metadata->>'destination_object_id',v_task.metadata->>'transplant_destination_object_id'),'')::uuid;
  exception when others then
    v_destination_id:=null;
  end;

  if v_destination_id is not null then
    select exists(select 1 from atlas.growing_objects go where go.id=v_destination_id and go.farm_id=v_task.farm_id)
    into v_destination_exists;
  end if;

  if v_type<>'transplanting' then
    v_state:='not_applicable'; v_ready:=true; v_source:='task_type';
  elsif v_operation not in ('establish_aboveground','establish_belowground','divide_reestablish_belowground') then
    v_state:='not_applicable'; v_ready:=true; v_source:='operation_class';
  elsif v_destination_exists then
    v_state:='ready'; v_ready:=true; v_source:='destination_object';
  elsif coalesce(v_zone_key,'')<>'grow_room' and v_task.zone_id is not null then
    v_state:='ready'; v_ready:=true; v_source:='canonical_execution_zone';
  elsif v_zone_key='grow_room' then
    v_state:='destination_required'; v_ready:=false; v_source:='source_zone_only';
    v_reason:=case
      when v_destination_text is null then 'Final transplant work sourced from the Grow Room has no destination object or execution zone.'
      when lower(v_destination_text) ~ '(choose|unknown|tbd|to be determined|at transplant time)' then 'Final transplant destination is explicitly unresolved.'
      else 'A text destination exists, but final transplant execution still needs a canonical destination object or non-Grow-Room execution zone.'
    end;
  else
    v_state:='destination_required'; v_ready:=false; v_source:='missing_destination_context';
    v_reason:='Transplant execution has no canonical destination object or execution zone.';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','task_execution_destination_readiness_v1',
    'taskId',v_task.id,'state',v_state,'ready',v_ready,'reason',v_reason,'source',v_source,
    'operationClass',nullif(v_operation,''),'taskType',nullif(v_type,''),'taskZoneKey',v_zone_key,
    'destinationObjectId',v_destination_id,'destinationObjectExists',v_destination_exists,
    'destinationText',v_destination_text
  ));
end;
$$;

create or replace function atlas.task_execution_readiness_v1(
  p_task_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_prereq boolean;
  v_resources boolean;
  v_destination jsonb;
begin
  v_prereq:=atlas.task_prerequisites_ready_v1(p_task_id);
  v_resources:=atlas.task_required_resources_available_v1(p_task_id);
  v_destination:=atlas.task_execution_destination_readiness_v1(p_task_id);
  return jsonb_build_object(
    'contractVersion','task_execution_readiness_v1','taskId',p_task_id,
    'ready',v_prereq and v_resources and coalesce((v_destination->>'ready')::boolean,false),
    'prerequisitesReady',v_prereq,'resourcesReady',v_resources,
    'destinationReady',coalesce((v_destination->>'ready')::boolean,false),
    'destination',v_destination
  );
end;
$$;

revoke all on function atlas.task_execution_destination_readiness_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.task_execution_destination_readiness_v1(uuid) to service_role;
revoke all on function atlas.task_execution_readiness_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.task_execution_readiness_v1(uuid) to service_role;