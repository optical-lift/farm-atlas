create or replace function atlas.inherit_task_farm_organization_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
begin
  if new.organization_id is null and new.farm_id is not null then
    select f.organization_id into new.organization_id
    from atlas.farms f where f.id=new.farm_id;
  end if;
  if new.organization_id is null then
    raise exception 'Task organization could not be resolved from its farm.' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists aa_tasks_inherit_farm_organization_v1 on atlas.tasks;
create trigger aa_tasks_inherit_farm_organization_v1
before insert or update of farm_id,organization_id on atlas.tasks
for each row execute function atlas.inherit_task_farm_organization_v1();
