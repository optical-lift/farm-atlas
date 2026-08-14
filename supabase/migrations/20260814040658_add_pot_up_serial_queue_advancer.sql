create or replace function atlas.advance_pot_up_serial_queue_v1()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'atlas'
as $function$
declare
  v_item atlas.task_release_queue_items%rowtype;
  v_completed_date date;
begin
  if new.status <> 'done' or old.status = 'done' then
    return new;
  end if;

  select qi.*
  into v_item
  from atlas.task_release_queue_items qi
  where qi.task_id = new.id
    and qi.state = 'active'
    and coalesce(qi.metadata ->> 'queue_kind', '') = 'pot_up_serial'
  for update;

  if not found then
    return new;
  end if;

  update atlas.task_release_queue_items
  set state = 'completed',
      completed_at = coalesce(new.completed_at, now()),
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'completed_task_id', new.id,
        'completed_at', coalesce(new.completed_at, now()),
        'completion_gate_advanced', true
      )
  where id = v_item.id;

  v_completed_date := (coalesce(new.completed_at, now()) at time zone 'America/Chicago')::date;

  perform atlas.release_next_task_in_queue_v1(
    v_item.farm_id,
    v_item.queue_key,
    v_completed_date
  );

  return new;
end;
$function$;

drop trigger if exists advance_pot_up_serial_queue_v1 on atlas.tasks;
create trigger advance_pot_up_serial_queue_v1
after update of status on atlas.tasks
for each row
when (old.status is distinct from new.status)
execute function atlas.advance_pot_up_serial_queue_v1();
