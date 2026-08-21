create or replace function atlas.attach_farm_round_member_task_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas'
as $function$
declare v_parent_occurrence_id uuid; v_parent_task_id uuid; v_result jsonb;
begin
  if new.parent_task_id is not null or new.planned_occurrence_id is null then return new; end if;
  select parent_occurrence_id into v_parent_occurrence_id from atlas.planned_work_occurrences where id=new.planned_occurrence_id;
  if v_parent_occurrence_id is null then return new; end if;
  if not exists(select 1 from atlas.planned_work_occurrences where id=v_parent_occurrence_id and metadata->>'farmRoundParent'='true') then return new; end if;
  select released_task_id into v_parent_task_id from atlas.planned_work_occurrences where id=v_parent_occurrence_id;
  if v_parent_task_id is null then
    v_result:=atlas.materialize_specific_work_occurrence_v1(v_parent_occurrence_id,coalesce(new.due_date,(now() at time zone 'America/Chicago')::date));
    v_parent_task_id:=nullif(v_result->>'taskId','')::uuid;
  end if;
  if v_parent_task_id is not null then
    update atlas.tasks set parent_task_id=v_parent_task_id,updated_at=now() where id=new.id and parent_task_id is null;
    update atlas.farm_round_occurrences set parent_task_id=v_parent_task_id,updated_at=now() where parent_occurrence_id=v_parent_occurrence_id;
  end if;
  return new;
end;
$function$;

create or replace function atlas.materialize_farm_round_members_v1(p_parent_occurrence_id uuid,p_service_date date)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','atlas'
as $function$
declare r record; v_result jsonb; v_count integer:=0;
begin
  if not exists(select 1 from atlas.planned_work_occurrences where id=p_parent_occurrence_id and metadata->>'farmRoundParent'='true') then return jsonb_build_object('state','not_farm_round'); end if;
  for r in select id from atlas.planned_work_occurrences where parent_occurrence_id=p_parent_occurrence_id and state not in ('released','completed','cancelled') order by id loop
    v_result:=atlas.materialize_specific_work_occurrence_v1(r.id,p_service_date);
    if nullif(v_result->>'taskId','') is not null then v_count:=v_count+1; end if;
  end loop;
  return jsonb_build_object('state','materialized','memberTasksMaterialized',v_count);
end;
$function$;

create or replace function atlas.materialize_farm_round_members_trigger_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.task_type='stewardship_round' and new.planned_occurrence_id is not null then
    perform atlas.materialize_farm_round_members_v1(new.planned_occurrence_id,new.due_date);
  end if;
  return new;
end;
$function$;

drop trigger if exists attach_farm_round_member_task_v1 on atlas.tasks;
create trigger attach_farm_round_member_task_v1 after insert or update of planned_occurrence_id on atlas.tasks
for each row when (new.parent_task_id is null and new.planned_occurrence_id is not null)
execute function atlas.attach_farm_round_member_task_v1();

drop trigger if exists materialize_farm_round_members_v1 on atlas.tasks;
create trigger materialize_farm_round_members_v1 after insert on atlas.tasks
for each row when (new.task_type='stewardship_round')
execute function atlas.materialize_farm_round_members_trigger_v1();

-- Bring currently released member tasks under their parent cards.
do $$
declare r record; begin
  for r in select parent_occurrence_id,service_date from atlas.farm_round_occurrences where status='open' and parent_occurrence_id is not null loop
    perform atlas.materialize_farm_round_members_v1(r.parent_occurrence_id,r.service_date);
  end loop;
end $$;
