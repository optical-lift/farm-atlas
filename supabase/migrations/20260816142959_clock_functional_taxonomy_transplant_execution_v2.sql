create or replace function atlas.task_clock_function_traits_v2(
  p_task_id uuid,
  p_service_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_packet jsonb;
  v_task atlas.tasks%rowtype;
  v_capacity record;
  v_tags text[]:=array[]::text[];
  v_load text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  v_packet:=atlas.task_clock_function_traits_v1(p_task_id,p_service_date);
  select * into v_capacity from atlas.task_capacity_plan_v1(v_task,coalesce(p_service_date,(now() at time zone 'America/Chicago')::date));
  v_load:=lower(coalesce(v_capacity.physical_load,'moderate'));

  select coalesce(array_agg(value order by value),array[]::text[])
  into v_tags
  from jsonb_array_elements_text(coalesce(v_packet->'traitKeys','[]'::jsonb));

  if lower(coalesce(v_task.metadata->>'environment','')) not in ('indoor','outdoor','either')
     and lower(coalesce(v_task.task_type,''))='transplanting'
     and lower(coalesce(v_task.operation_class,'')) in ('establish_aboveground','establish_belowground','divide_reestablish_belowground')
  then
    v_packet:=v_packet||jsonb_build_object(
      'environment','outdoor',
      'environmentSource','final_transplant_execution_default'
    );
    v_tags:=array_remove(v_tags,'outdoor_heavy');
    v_tags:=array_remove(v_tags,'outdoor_light');
    v_tags:=array_append(v_tags,case when v_load='heavy' then 'outdoor_heavy' else 'outdoor_light' end);

    if coalesce(v_packet->>'taskZoneKey','')='grow_room' then
      if not ('propagation'=any(v_tags)) then v_tags:=array_append(v_tags,'propagation'); end if;
      v_packet:=v_packet||jsonb_build_object(
        'propagationTransition','grow_room_to_final_destination'
      );
    end if;
  end if;

  select coalesce(array_agg(distinct x order by x),array[]::text[]) into v_tags from unnest(v_tags) x;
  return v_packet||jsonb_build_object(
    'contractVersion','task_clock_function_traits_v2',
    'traitKeys',to_jsonb(v_tags)
  );
end;
$$;

revoke all on function atlas.task_clock_function_traits_v2(uuid,date) from public, anon, authenticated;
grant execute on function atlas.task_clock_function_traits_v2(uuid,date) to service_role;