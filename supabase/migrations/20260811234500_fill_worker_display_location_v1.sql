-- Assigned worker work should answer "where?" without forcing every planner
-- surface to understand every historical location field. Preserve the richer
-- address/location metadata, but fill the short display label from canonical
-- task place truth when it is missing.

create or replace function atlas.fill_worker_display_location_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_location text;
begin
  if new.visibility_scope<>'assigned_worker'
     or new.assigned_membership_id is null
     or nullif(btrim(coalesce(new.metadata->>'display_location','')),'') is not null then
    return new;
  end if;

  v_location:=coalesce(
    nullif(btrim(coalesce(new.metadata->>'location_name','')),''),
    nullif(btrim(coalesce(new.metadata->>'departure_label','')),''),
    nullif(btrim(coalesce(new.metadata->>'address','')),'')
  );

  if v_location is not null then
    new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'display_location',v_location,
      'display_location_source',case
        when nullif(btrim(coalesce(new.metadata->>'location_name','')),'') is not null then 'location_name'
        when nullif(btrim(coalesce(new.metadata->>'departure_label','')),'') is not null then 'departure_label'
        else 'address'
      end
    );
  end if;

  return new;
end;
$function$;

revoke all on function atlas.fill_worker_display_location_v1() from public,anon,authenticated;
grant execute on function atlas.fill_worker_display_location_v1() to service_role;

drop trigger if exists fill_worker_display_location_v1 on atlas.tasks;
create trigger fill_worker_display_location_v1
before insert or update of metadata,visibility_scope,assigned_membership_id
on atlas.tasks
for each row execute function atlas.fill_worker_display_location_v1();

update atlas.tasks task
set metadata=coalesce(task.metadata,'{}'::jsonb) || jsonb_build_object(
      'display_location',coalesce(
        nullif(btrim(coalesce(task.metadata->>'location_name','')),''),
        nullif(btrim(coalesce(task.metadata->>'departure_label','')),''),
        nullif(btrim(coalesce(task.metadata->>'address','')),'')
      ),
      'display_location_source',case
        when nullif(btrim(coalesce(task.metadata->>'location_name','')),'') is not null then 'location_name'
        when nullif(btrim(coalesce(task.metadata->>'departure_label','')),'') is not null then 'departure_label'
        else 'address'
      end
    ),
    updated_at=now()
where task.status in ('open','blocked')
  and task.visibility_scope='assigned_worker'
  and task.assigned_membership_id is not null
  and nullif(btrim(coalesce(task.metadata->>'display_location','')),'') is null
  and coalesce(
    nullif(btrim(coalesce(task.metadata->>'location_name','')),''),
    nullif(btrim(coalesce(task.metadata->>'departure_label','')),''),
    nullif(btrim(coalesce(task.metadata->>'address','')),'')
  ) is not null;
