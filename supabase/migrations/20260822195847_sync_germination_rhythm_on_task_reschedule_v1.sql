create or replace function atlas.sync_germination_watch_from_task_schedule_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle_id uuid;
begin
  if new.status not in ('open','blocked')
     or new.due_date is null
     or not atlas.is_germination_task_v1(new) then
    return new;
  end if;

  for v_cycle_id in
    select distinct link.crop_cycle_id
    from atlas.task_crop_cycles link
    join atlas.crop_cycles cycle on cycle.id=link.crop_cycle_id
    where link.task_id=new.id
      and link.confidence='confirmed'
      and cycle.farm_id=new.farm_id
      and cycle.lifecycle_status in ('active','planned')
      and cycle.cycle_state in ('sown','germinating','germination_pending','emerging')
  loop
    perform atlas.enroll_germination_watch_v1(v_cycle_id,new.id);
  end loop;
  return new;
end;
$function$;

revoke all on function atlas.sync_germination_watch_from_task_schedule_v1() from public,anon,authenticated;

drop trigger if exists trg_sync_germination_watch_from_task_schedule_v1 on atlas.tasks;
create trigger trg_sync_germination_watch_from_task_schedule_v1
after update of due_date on atlas.tasks
for each row
when (old.due_date is distinct from new.due_date)
execute function atlas.sync_germination_watch_from_task_schedule_v1();

-- Reconcile currently open exact germination carriers to their currently recorded
-- task due dates. This preserves the task history; it only realigns the active
-- rhythm contract that should have followed those reschedules already.
do $block$
declare
  r record;
begin
  for r in
    select distinct t.id task_id,link.crop_cycle_id
    from atlas.tasks t
    join atlas.task_crop_cycles link on link.task_id=t.id and link.confidence='confirmed'
    join atlas.crop_cycles cycle on cycle.id=link.crop_cycle_id
    where t.status in ('open','blocked')
      and atlas.is_germination_task_v1(t)
      and t.due_date is not null
      and cycle.farm_id=t.farm_id
      and cycle.lifecycle_status in ('active','planned')
      and cycle.cycle_state in ('sown','germinating','germination_pending','emerging')
  loop
    perform atlas.enroll_germination_watch_v1(r.crop_cycle_id,r.task_id);
  end loop;
end;
$block$;
