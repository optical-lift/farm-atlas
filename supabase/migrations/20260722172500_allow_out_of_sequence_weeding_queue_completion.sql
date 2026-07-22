-- Allow a Field Row weeding task to be completed from the visible queue even
-- when it has not released into Today yet. Completing a waiting item removes
-- it from the future sequence but does not release additional work.

create or replace function atlas.advance_task_release_queue_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
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
    and qi.state in ('active', 'queued')
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
        'completed_from_state', v_item.state,
        'completed_out_of_sequence', v_item.state = 'queued'
      )
  where id = v_item.id;

  v_completed_date := (coalesce(new.completed_at, now()) at time zone 'America/Chicago')::date;

  if v_item.state = 'active' then
    perform atlas.release_next_task_in_queue_v1(
      v_item.farm_id,
      v_item.queue_key,
      v_completed_date
    );
  else
    perform atlas.sync_task_release_queue_summary_v1(
      v_item.farm_id,
      v_item.queue_key
    );
  end if;

  return new;
end;
$function$;

comment on function atlas.advance_task_release_queue_v1() is
  'Marks active or waiting queue tasks complete. Only active completion advances the queue; waiting completion removes that item without releasing extra work.';
