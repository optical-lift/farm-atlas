create or replace function atlas.attach_apply_treatment_target_v1(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_object_id uuid;
  v_object_key text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null or v_task.action_key<>'spray' or v_task.operation_class<>'apply_treatment' then return null; end if;

  begin
    v_object_id:=nullif(v_task.metadata->>'target_object_id','')::uuid;
  exception when invalid_text_representation then
    v_object_id:=null;
  end;
  v_object_key:=nullif(v_task.metadata->>'target_object_key','');

  if v_object_id is null and v_object_key is not null then
    select id into v_object_id from atlas.growing_objects
    where farm_id=v_task.farm_id and stable_key=v_object_key
    limit 1;
  end if;

  if v_object_id is null then
    select x.object_id into v_object_id
    from atlas.task_objects x
    where x.task_id=v_task.id
    order by x.created_at
    limit 1;
  end if;

  if v_object_id is null then return null; end if;

  insert into atlas.task_objects(task_id,object_id,role)
  values(v_task.id,v_object_id,'target')
  on conflict (task_id,object_id) do update set role='target';

  return v_object_id;
end;
$function$;

create or replace function atlas.attach_apply_treatment_target_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.action_key='spray' and new.operation_class='apply_treatment' then
    perform atlas.attach_apply_treatment_target_v1(new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists attach_apply_treatment_target_v1 on atlas.tasks;
create trigger attach_apply_treatment_target_v1
after insert or update of metadata,action_key,operation_class on atlas.tasks
for each row execute function atlas.attach_apply_treatment_target_trigger_v1();

with targets as (
  select distinct on (t.id)
    t.id as task_id,
    x.object_id,
    go.stable_key
  from atlas.tasks t
  join atlas.task_objects x on x.task_id=t.id
  join atlas.growing_objects go on go.id=x.object_id
  where t.action_key='spray' and t.operation_class='apply_treatment'
  order by t.id,x.created_at
)
update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
  'target_object_id',targets.object_id,
  'target_object_key',targets.stable_key,
  'target_object_contract','apply_treatment_target_v1'
),updated_at=now()
from targets
where targets.task_id=t.id;

update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
  'target_object_id',go.id,
  'target_object_key',go.stable_key,
  'target_object_contract','apply_treatment_target_v1',
  'target_object_repaired_by','spray_target_object_contract_v2'
),updated_at=now()
from atlas.growing_objects go
where t.farm_id=go.farm_id
  and go.stable_key='bb_10'
  and t.action_key='spray'
  and t.operation_class='apply_treatment'
  and t.metadata->>'task_key' like 'anna_%spray_bb10_bermuda_pass_%';

do $$ declare r record; begin
  for r in select id from atlas.tasks where action_key='spray' and operation_class='apply_treatment' loop
    perform atlas.attach_apply_treatment_target_v1(r.id);
  end loop;
end $$;
