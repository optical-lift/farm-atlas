-- Event projects belong to a real place. Execution tasks that prepare that event
-- should not be placeless when the project already has a canonical zone. Keep
-- off-farm harvest, purchasing, marketing, and other project work independent;
-- only event_setup work inherits a missing zone from its project.

create or replace function atlas.sync_event_setup_task_zone_from_project_link_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_project atlas.projects%rowtype;
  v_task atlas.tasks%rowtype;
begin
  select * into v_project
  from atlas.projects
  where id=new.project_id;

  if v_project.id is null or v_project.zone_id is null then
    return new;
  end if;

  select * into v_task
  from atlas.tasks
  where id=new.task_id;

  if v_task.id is null
     or v_task.farm_id is distinct from v_project.farm_id
     or v_task.task_type is distinct from 'event_setup'
     or v_task.zone_id is not null then
    return new;
  end if;

  update atlas.tasks task
  set zone_id=v_project.zone_id,
      metadata=coalesce(task.metadata,'{}'::jsonb) || jsonb_build_object(
        'zone_assignment_source','event_project_zone',
        'zone_assignment_project_id',v_project.id,
        'zone_assignment_synced_at',now()
      ),
      updated_at=now()
  where task.id=v_task.id
    and task.zone_id is null;

  return new;
end;
$function$;

create or replace function atlas.sync_event_setup_tasks_when_project_zone_changes_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.zone_id is null or new.zone_id is not distinct from old.zone_id then
    return new;
  end if;

  update atlas.tasks task
  set zone_id=new.zone_id,
      metadata=coalesce(task.metadata,'{}'::jsonb) || jsonb_build_object(
        'zone_assignment_source','event_project_zone',
        'zone_assignment_project_id',new.id,
        'zone_assignment_synced_at',now()
      ),
      updated_at=now()
  from atlas.project_task_links link
  where link.project_id=new.id
    and link.task_id=task.id
    and task.farm_id=new.farm_id
    and task.task_type='event_setup'
    and task.zone_id is null;

  return new;
end;
$function$;

revoke all on function atlas.sync_event_setup_task_zone_from_project_link_v1() from public,anon,authenticated;
revoke all on function atlas.sync_event_setup_tasks_when_project_zone_changes_v1() from public,anon,authenticated;

drop trigger if exists sync_event_setup_task_zone_from_project_link_v1 on atlas.project_task_links;
create trigger sync_event_setup_task_zone_from_project_link_v1
after insert or update of project_id,task_id on atlas.project_task_links
for each row
execute function atlas.sync_event_setup_task_zone_from_project_link_v1();

drop trigger if exists sync_event_setup_tasks_when_project_zone_changes_v1 on atlas.projects;
create trigger sync_event_setup_tasks_when_project_zone_changes_v1
after update of zone_id on atlas.projects
for each row
when (new.zone_id is not null and old.zone_id is distinct from new.zone_id)
execute function atlas.sync_event_setup_tasks_when_project_zone_changes_v1();

-- The Aug. 13 open-house project is explicitly a Venue operation: its canonical
-- tracking task names the conference room and arrival route, and its execution
-- tasks prepare the room, porch, restroom route, stations, and guest flow. Set the
-- broad project place to the existing Venue zone; the trigger then gives only its
-- event_setup tasks that same broad place without inventing micro-location truth.
do $block$
declare
  v_project atlas.projects%rowtype;
  v_venue_zone_id uuid;
begin
  select * into v_project
  from atlas.projects project
  where project.stable_key='elm_first_ticketed_thursday_bloom_bar_2026_08_13';

  if v_project.id is null then
    return;
  end if;

  select zone.id into v_venue_zone_id
  from atlas.zones zone
  where zone.farm_id=v_project.farm_id
    and zone.stable_key='venue';

  if v_venue_zone_id is null then
    raise exception 'Venue zone is missing for the Bloom Bar project farm; refusing place reconciliation.';
  end if;

  update atlas.projects project
  set zone_id=v_venue_zone_id,
      metadata=coalesce(project.metadata,'{}'::jsonb) || jsonb_build_object(
        'zone_assignment_source','canonical_event_place_reconciliation',
        'zone_assignment_synced_at',now()
      ),
      updated_at=now()
  where project.id=v_project.id
    and project.zone_id is null;

  -- Idempotent backfill in case the project was already zoned before this migration.
  update atlas.tasks task
  set zone_id=v_venue_zone_id,
      metadata=coalesce(task.metadata,'{}'::jsonb) || jsonb_build_object(
        'zone_assignment_source','event_project_zone',
        'zone_assignment_project_id',v_project.id,
        'zone_assignment_synced_at',now()
      ),
      updated_at=now()
  from atlas.project_task_links link
  where link.project_id=v_project.id
    and link.task_id=task.id
    and task.farm_id=v_project.farm_id
    and task.task_type='event_setup'
    and task.zone_id is null;
end;
$block$;
