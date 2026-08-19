do $migration$
declare
  v_def text;
  v_old text := $$v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,v_day);
    if coalesce(v_capacity->>'state','') not in ('working_day') then
      raise exception 'Worker Day is not available on %.',v_day using errcode='55000';
    end if;
    v_target:=case when v_capacity->>'capacityClass'='recovery'$$;
  v_new text := $$v_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,v_day);
    if coalesce(v_capacity->>'state','') not in ('working_day') then
      raise exception 'Worker Day is not available on %.',v_day using errcode='55000';
    end if;
    if v_window='evening'
       and nullif(v_capacity->>'localEnd','') is not null
       and (v_capacity->>'localEnd')::time <= time '17:00' then
      v_window:='afternoon';
    end if;
    v_target:=case when v_capacity->>'capacityClass'='recovery'$$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='management_commit_worker_required_placements_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_actor_user_id uuid, p_plan jsonb';
  if v_def is null then raise exception 'management placement function not found'; end if;
  if position(v_old in v_def)=0 then raise exception 'expected day capacity fragment not found'; end if;
  v_def:=replace(v_def,v_old,v_new);
  execute v_def;
end;
$migration$;