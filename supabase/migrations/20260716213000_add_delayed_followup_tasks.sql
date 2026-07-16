create or replace function atlas.create_delayed_followup_task()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_spec jsonb;
  v_delay_days integer;
  v_due_date date;
  v_zone_id uuid;
  v_object_key text;
  v_object_id uuid;
  v_followup_id uuid;
  v_instance_key text;
begin
  if new.status <> 'done' or old.status = 'done' then
    return new;
  end if;

  v_spec := coalesce(new.metadata -> 'follow_up_task', '{}'::jsonb);
  if jsonb_typeof(v_spec) <> 'object' or coalesce(v_spec ->> 'title', '') = '' then
    return new;
  end if;

  begin
    v_delay_days := greatest(0, coalesce((v_spec ->> 'delay_days')::integer, 0));
  exception when others then
    v_delay_days := 0;
  end;

  v_due_date := (coalesce(new.completed_at, now()) at time zone 'America/Chicago')::date + v_delay_days;

  select z.id into v_zone_id
  from atlas.zones z
  where z.farm_id = new.farm_id
    and z.stable_key = nullif(v_spec ->> 'zone_key', '')
  limit 1;

  v_instance_key := 'followup:' || new.id::text || ':' || md5(v_spec::text) || ':' || v_due_date::text;

  select t.id into v_followup_id
  from atlas.tasks t
  where t.farm_id = new.farm_id
    and t.engine_instance_key = v_instance_key
  limit 1;

  if v_followup_id is null then
    insert into atlas.tasks (
      farm_id,
      zone_id,
      title,
      task_type,
      status,
      priority,
      due_date,
      unlock_text,
      generated_from,
      generated_from_id,
      note,
      metadata,
      action_key,
      work_class,
      parent_task_id,
      task_series_key,
      engine_instance_key,
      updated_at
    ) values (
      new.farm_id,
      v_zone_id,
      v_spec ->> 'title',
      coalesce(nullif(v_spec ->> 'task_type', ''), 'general'),
      'open',
      coalesce(nullif(v_spec ->> 'priority', ''), 'normal'),
      v_due_date,
      nullif(v_spec ->> 'unlock_text', ''),
      'task_follow_up',
      new.id,
      nullif(v_spec ->> 'note', ''),
      (coalesce(v_spec -> 'metadata', '{}'::jsonb) || jsonb_build_object(
        'triggered_by_task_id', new.id,
        'triggered_by_task_title', new.title,
        'triggered_at', now(),
        'delay_days', v_delay_days,
        'assigned_to', coalesce(nullif(v_spec ->> 'assigned_to', ''), 'Anna'),
        'display_action', coalesce(nullif(v_spec ->> 'display_action', ''), 'Start'),
        'display_subject', coalesce(nullif(v_spec ->> 'display_subject', ''), v_spec ->> 'title'),
        'collection_zone', coalesce(nullif(v_spec ->> 'collection_zone', ''), 'Grow Room'),
        'work_route', coalesce(nullif(v_spec ->> 'action_key', ''), 'seed_starting')
      )),
      coalesce(nullif(v_spec ->> 'action_key', ''), 'seed_starting'),
      coalesce(nullif(v_spec ->> 'work_class', ''), 'standard'),
      new.id,
      coalesce(nullif(v_spec ->> 'series_key', ''), 'followup_' || new.id::text),
      v_instance_key,
      now()
    ) returning id into v_followup_id;

    v_object_key := nullif(v_spec ->> 'object_key', '');
    if v_object_key is not null then
      select go.id into v_object_id
      from atlas.growing_objects go
      where go.farm_id = new.farm_id
        and go.stable_key = v_object_key
      limit 1;

      if v_object_id is not null then
        insert into atlas.task_objects (task_id, object_id, role)
        values (v_followup_id, v_object_id, 'target')
        on conflict (task_id, object_id) do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_create_delayed_followup_task on atlas.tasks;
create trigger trg_create_delayed_followup_task
after update of status on atlas.tasks
for each row
execute function atlas.create_delayed_followup_task();
