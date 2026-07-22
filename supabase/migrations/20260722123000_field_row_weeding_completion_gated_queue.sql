-- Convert Field Row maintenance weeding from pre-dated daily work into a
-- completion-gated queue. The first batch is owner-directed for 2026-07-22;
-- after it is finished, exactly one next row releases for the next workday.

create table if not exists atlas.task_release_queue_items (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  queue_key text not null,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  maintenance_object_id uuid references atlas.maintenance_objects(id) on delete set null,
  position integer not null check (position > 0),
  state text not null check (state in ('active','queued','completed','skipped')),
  initial_batch boolean not null default false,
  original_due_date date,
  activated_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id),
  unique (farm_id, queue_key, position)
);

create index if not exists task_release_queue_items_lookup_idx
  on atlas.task_release_queue_items (farm_id, queue_key, state, position);

create index if not exists task_release_queue_items_maintenance_idx
  on atlas.task_release_queue_items (farm_id, queue_key, maintenance_object_id, state);

alter table atlas.task_release_queue_items enable row level security;
revoke all on atlas.task_release_queue_items from anon, authenticated;

drop trigger if exists set_task_release_queue_items_updated_at on atlas.task_release_queue_items;
create trigger set_task_release_queue_items_updated_at
before update on atlas.task_release_queue_items
for each row execute function atlas.set_updated_at();

create or replace function atlas.sync_task_release_queue_summary_v1(
  p_farm_id uuid,
  p_queue_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_active_count integer;
  v_queued_count integer;
  v_completed_count integer;
  v_next_label text;
begin
  select
    count(*) filter (where qi.state = 'active'),
    count(*) filter (where qi.state = 'queued'),
    count(*) filter (where qi.state = 'completed'),
    (
      select coalesce(
        nullif(t.metadata ->> 'display_subject', ''),
        nullif(t.metadata ->> 'collection_label', ''),
        t.title
      )
      from atlas.task_release_queue_items next_qi
      join atlas.tasks t on t.id = next_qi.task_id
      where next_qi.farm_id = p_farm_id
        and next_qi.queue_key = p_queue_key
        and next_qi.state = 'queued'
      order by next_qi.position
      limit 1
    )
  into v_active_count, v_queued_count, v_completed_count, v_next_label
  from atlas.task_release_queue_items qi
  where qi.farm_id = p_farm_id
    and qi.queue_key = p_queue_key;

  update atlas.tasks t
  set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'release_queue_key', qi.queue_key,
        'release_queue_state', qi.state,
        'release_queue_position', qi.position,
        'release_queue_initial_batch', qi.initial_batch,
        'release_queue_policy', 'completion_gated_serial',
        'release_queue_active_count', coalesce(v_active_count, 0),
        'release_queue_queued_count', coalesce(v_queued_count, 0),
        'release_queue_completed_count', coalesce(v_completed_count, 0),
        'release_queue_next_label', coalesce(v_next_label, ''),
        'release_queue_summary_updated_at', now()
      ),
      updated_at = now()
  from atlas.task_release_queue_items qi
  where qi.task_id = t.id
    and qi.farm_id = p_farm_id
    and qi.queue_key = p_queue_key
    and qi.state in ('active','queued');
end;
$function$;

create or replace function atlas.release_next_task_in_queue_v1(
  p_farm_id uuid,
  p_queue_key text,
  p_completed_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_next_item atlas.task_release_queue_items%rowtype;
  v_due_date date;
  v_completed_date date := coalesce(
    p_completed_date,
    (now() at time zone 'America/Chicago')::date
  );
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_farm_id::text || ':' || p_queue_key, 0)
  );

  if exists (
    select 1
    from atlas.task_release_queue_items qi
    join atlas.tasks t on t.id = qi.task_id
    where qi.farm_id = p_farm_id
      and qi.queue_key = p_queue_key
      and qi.initial_batch
      and qi.state <> 'completed'
      and t.status <> 'done'
  ) then
    perform atlas.sync_task_release_queue_summary_v1(p_farm_id, p_queue_key);
    return null;
  end if;

  select qi.*
  into v_next_item
  from atlas.task_release_queue_items qi
  where qi.farm_id = p_farm_id
    and qi.queue_key = p_queue_key
    and qi.state = 'queued'
  order by qi.position
  for update
  limit 1;

  if not found then
    perform atlas.sync_task_release_queue_summary_v1(p_farm_id, p_queue_key);
    return null;
  end if;

  v_due_date := v_completed_date + 1;
  if extract(dow from v_due_date) = 0 then
    v_due_date := v_due_date + 1;
  end if;

  update atlas.task_release_queue_items
  set state = 'active',
      activated_at = now(),
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'released_after_completion', true,
        'released_for_date', v_due_date,
        'released_at', now()
      )
  where id = v_next_item.id;

  update atlas.tasks
  set status = 'open',
      due_date = v_due_date,
      completed_at = null,
      completed_by = null,
      engine_instance_key = null,
      metadata = ((coalesce(metadata, '{}'::jsonb) - 'archived_reason') - 'archived_at')
        || jsonb_build_object(
          'release_queue_key', p_queue_key,
          'release_queue_state', 'active',
          'release_queue_position', v_next_item.position,
          'release_queue_initial_batch', false,
          'release_queue_policy', 'completion_gated_serial',
          'released_after_previous_completion', true,
          'released_for_date', v_due_date,
          'released_at', now()
        ),
      updated_at = now()
  where id = v_next_item.task_id;

  perform atlas.sync_task_release_queue_summary_v1(p_farm_id, p_queue_key);
  return v_next_item.task_id;
end;
$function$;

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
    and qi.state = 'active'
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
        'completed_at', coalesce(new.completed_at, now())
      )
  where id = v_item.id;

  v_completed_date := coalesce(new.completed_at, now())::date;

  perform atlas.release_next_task_in_queue_v1(
    v_item.farm_id,
    v_item.queue_key,
    v_completed_date
  );

  return new;
end;
$function$;

drop trigger if exists trg_advance_task_release_queue_v1 on atlas.tasks;
create trigger trg_advance_task_release_queue_v1
after update of status on atlas.tasks
for each row
when (old.status is distinct from new.status)
execute function atlas.advance_task_release_queue_v1();

create or replace function atlas.protect_active_release_queue_task_from_refresh_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
begin
  if old.status in ('open','blocked')
     and new.status = 'archived'
     and old.metadata ->> 'release_queue_state' = 'active'
     and old.metadata ->> 'release_queue_key' = 'field_rows_weeding_rotation'
     and new.metadata ->> 'archived_reason' = 'Replaced by intelligent Weeding collection refresh'
  then
    new.status := old.status;
    new.due_date := old.due_date;
    new.metadata := coalesce(old.metadata, '{}'::jsonb)
      || ((coalesce(new.metadata, '{}'::jsonb) - 'archived_reason') - 'archived_at');
  end if;

  return new;
end;
$function$;

drop trigger if exists a_protect_active_release_queue_task_from_refresh_v1 on atlas.tasks;
create trigger a_protect_active_release_queue_task_from_refresh_v1
before update of status, metadata on atlas.tasks
for each row
execute function atlas.protect_active_release_queue_task_from_refresh_v1();

create or replace function atlas.enqueue_new_field_row_weeding_task_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_zone_key text;
  v_queue_key constant text := 'field_rows_weeding_rotation';
  v_maintenance_object_id uuid;
  v_position integer;
begin
  if new.generated_from is distinct from 'maintenance_weeding_collection' then
    return new;
  end if;

  select z.stable_key into v_zone_key
  from atlas.zones z
  where z.id = new.zone_id;

  if v_zone_key is distinct from 'field_rows' then
    return new;
  end if;

  if not exists (
    select 1
    from atlas.task_release_queue_items qi
    where qi.farm_id = new.farm_id
      and qi.queue_key = v_queue_key
  ) then
    return new;
  end if;

  v_maintenance_object_id := new.generated_from_id;
  if v_maintenance_object_id is null
     and coalesce(new.metadata ->> 'maintenance_object_id', '')
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    v_maintenance_object_id := (new.metadata ->> 'maintenance_object_id')::uuid;
  end if;

  if exists (
    select 1
    from atlas.task_release_queue_items qi
    where qi.farm_id = new.farm_id
      and qi.queue_key = v_queue_key
      and qi.maintenance_object_id = v_maintenance_object_id
      and qi.state in ('active','queued')
  ) then
    update atlas.tasks
    set status = 'archived',
        due_date = null,
        engine_instance_key = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'archived_reason', 'duplicate_field_row_weeding_queue_refresh',
          'release_queue_key', v_queue_key,
          'release_queue_state', 'duplicate_archived',
          'archived_at', now()
        ),
        updated_at = now()
    where id = new.id;
    return new;
  end if;

  select coalesce(max(qi.position), 0) + 1
  into v_position
  from atlas.task_release_queue_items qi
  where qi.farm_id = new.farm_id
    and qi.queue_key = v_queue_key;

  insert into atlas.task_release_queue_items (
    farm_id,
    queue_key,
    task_id,
    maintenance_object_id,
    position,
    state,
    initial_batch,
    original_due_date,
    metadata
  ) values (
    new.farm_id,
    v_queue_key,
    new.id,
    v_maintenance_object_id,
    v_position,
    'queued',
    false,
    new.due_date,
    jsonb_build_object(
      'source', 'automatic_field_row_weeding_refresh',
      'queued_at', now()
    )
  );

  update atlas.tasks
  set status = 'archived',
      due_date = null,
      engine_instance_key = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'release_queue_key', v_queue_key,
        'release_queue_state', 'queued',
        'release_queue_position', v_position,
        'release_queue_initial_batch', false,
        'release_queue_policy', 'completion_gated_serial',
        'original_scheduled_date', new.due_date,
        'archived_reason', 'waiting_in_completion_gated_field_row_queue',
        'queued_at', now()
      ),
      updated_at = now()
  where id = new.id;

  perform atlas.sync_task_release_queue_summary_v1(new.farm_id, v_queue_key);
  return new;
end;
$function$;

drop trigger if exists trg_enqueue_new_field_row_weeding_task_v1 on atlas.tasks;
create trigger trg_enqueue_new_field_row_weeding_task_v1
after insert on atlas.tasks
for each row
execute function atlas.enqueue_new_field_row_weeding_task_v1();

do $seed_queue$
declare
  v_farm_id uuid := '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  v_queue_key text := 'field_rows_weeding_rotation';
begin
  insert into atlas.task_release_queue_items (
    farm_id,
    queue_key,
    task_id,
    maintenance_object_id,
    position,
    state,
    initial_batch,
    original_due_date,
    activated_at,
    metadata
  )
  select
    v_farm_id,
    v_queue_key,
    t.id,
    t.generated_from_id,
    case t.id
      when 'dba58d03-b8ec-4579-913c-0ec2e6375e3d'::uuid then 1
      when 'ee0830af-36f7-4a06-beee-d59ae7ae8d1b'::uuid then 2
      when '2a3a6d7c-e96f-4fd3-8dc5-867675c71dc6'::uuid then 3
      when '5af7425b-c967-404e-8109-fb9faf059c2e'::uuid then 4
      when '0cc15f8e-8737-4580-99e6-72ab3dfde45e'::uuid then 5
      when 'faf64c4f-4309-4775-afb4-2f088ad07f40'::uuid then 6
      when '7a3ec040-8837-4933-9685-5ff08e1ae142'::uuid then 7
      when '410e30ce-7c0b-4815-8425-a4968def4a86'::uuid then 8
      when '1aeefce8-cb0a-49f6-9bba-b6618dcd1963'::uuid then 9
      when 'b6e43d2c-18c6-4034-b9e3-ad11b347fb71'::uuid then 10
      when '001bf867-9341-47de-a283-25c10b4f0c74'::uuid then 11
    end,
    case when t.id in (
      'dba58d03-b8ec-4579-913c-0ec2e6375e3d'::uuid,
      'ee0830af-36f7-4a06-beee-d59ae7ae8d1b'::uuid,
      '2a3a6d7c-e96f-4fd3-8dc5-867675c71dc6'::uuid
    ) then 'active' else 'queued' end,
    t.id in (
      'dba58d03-b8ec-4579-913c-0ec2e6375e3d'::uuid,
      'ee0830af-36f7-4a06-beee-d59ae7ae8d1b'::uuid,
      '2a3a6d7c-e96f-4fd3-8dc5-867675c71dc6'::uuid
    ),
    t.due_date,
    case when t.id in (
      'dba58d03-b8ec-4579-913c-0ec2e6375e3d'::uuid,
      'ee0830af-36f7-4a06-beee-d59ae7ae8d1b'::uuid,
      '2a3a6d7c-e96f-4fd3-8dc5-867675c71dc6'::uuid
    ) then now() else null end,
    jsonb_build_object(
      'source', 'owner_directed_field_row_queue',
      'seeded_at', now()
    )
  from atlas.tasks t
  where t.id in (
    'dba58d03-b8ec-4579-913c-0ec2e6375e3d'::uuid,
    'ee0830af-36f7-4a06-beee-d59ae7ae8d1b'::uuid,
    '2a3a6d7c-e96f-4fd3-8dc5-867675c71dc6'::uuid,
    '5af7425b-c967-404e-8109-fb9faf059c2e'::uuid,
    '0cc15f8e-8737-4580-99e6-72ab3dfde45e'::uuid,
    'faf64c4f-4309-4775-afb4-2f088ad07f40'::uuid,
    '7a3ec040-8837-4933-9685-5ff08e1ae142'::uuid,
    '410e30ce-7c0b-4815-8425-a4968def4a86'::uuid,
    '1aeefce8-cb0a-49f6-9bba-b6618dcd1963'::uuid,
    'b6e43d2c-18c6-4034-b9e3-ad11b347fb71'::uuid,
    '001bf867-9341-47de-a283-25c10b4f0c74'::uuid
  )
  on conflict (task_id) do nothing;

  update atlas.tasks t
  set status = 'open',
      due_date = date '2026-07-22',
      completed_at = null,
      completed_by = null,
      engine_instance_key = null,
      metadata = ((coalesce(t.metadata, '{}'::jsonb) - 'archived_reason') - 'archived_at')
        || jsonb_build_object(
          'release_queue_key', v_queue_key,
          'release_queue_state', 'active',
          'release_queue_initial_batch', true,
          'release_queue_policy', 'completion_gated_serial',
          'owner_directed_active_date', date '2026-07-22',
          'owner_directed_queue_seed', true
        ),
      updated_at = now()
  from atlas.task_release_queue_items qi
  where qi.task_id = t.id
    and qi.farm_id = v_farm_id
    and qi.queue_key = v_queue_key
    and qi.initial_batch;

  update atlas.tasks t
  set status = 'archived',
      due_date = null,
      engine_instance_key = null,
      metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'release_queue_key', v_queue_key,
        'release_queue_state', 'queued',
        'release_queue_initial_batch', false,
        'release_queue_policy', 'completion_gated_serial',
        'original_scheduled_date', qi.original_due_date,
        'archived_reason', 'waiting_in_completion_gated_field_row_queue',
        'queued_at', now()
      ),
      updated_at = now()
  from atlas.task_release_queue_items qi
  where qi.task_id = t.id
    and qi.farm_id = v_farm_id
    and qi.queue_key = v_queue_key
    and not qi.initial_batch;

  perform atlas.sync_task_release_queue_summary_v1(v_farm_id, v_queue_key);
end;
$seed_queue$;

do $validation$
declare
  v_farm_id uuid := '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  v_queue_key text := 'field_rows_weeding_rotation';
  v_active_titles text[];
begin
  select array_agg(t.title order by qi.position)
  into v_active_titles
  from atlas.task_release_queue_items qi
  join atlas.tasks t on t.id = qi.task_id
  where qi.farm_id = v_farm_id
    and qi.queue_key = v_queue_key
    and qi.state = 'active';

  if v_active_titles is distinct from array[
    'Weed Field Row 18',
    'Weed Field Row 13',
    'Cut back weeds in Field Row 3'
  ]::text[] then
    raise exception 'Unexpected active Field Row weeding batch: %', v_active_titles;
  end if;

  if (select count(*) from atlas.task_release_queue_items where farm_id=v_farm_id and queue_key=v_queue_key and state='active') <> 3 then
    raise exception 'Field Row queue must begin with exactly three active tasks.';
  end if;

  if (select count(*) from atlas.task_release_queue_items where farm_id=v_farm_id and queue_key=v_queue_key and state='queued') <> 8 then
    raise exception 'Field Row queue must begin with exactly eight waiting tasks.';
  end if;

  if exists (
    select 1
    from atlas.task_release_queue_items qi
    join atlas.tasks t on t.id=qi.task_id
    where qi.farm_id=v_farm_id
      and qi.queue_key=v_queue_key
      and qi.state='active'
      and (t.status <> 'open' or t.due_date <> date '2026-07-22')
  ) then
    raise exception 'Every initial Field Row queue task must be open and due 2026-07-22.';
  end if;

  if exists (
    select 1
    from atlas.task_release_queue_items qi
    join atlas.tasks t on t.id=qi.task_id
    where qi.farm_id=v_farm_id
      and qi.queue_key=v_queue_key
      and qi.state='queued'
      and (t.status <> 'archived' or t.due_date is not null)
  ) then
    raise exception 'Waiting Field Row queue tasks must be archived and undated.';
  end if;

  if exists (
    select 1
    from atlas.tasks t
    join atlas.zones z on z.id=t.zone_id
    where t.farm_id=v_farm_id
      and z.stable_key='field_rows'
      and t.generated_from='maintenance_weeding_collection'
      and t.status in ('open','blocked')
      and t.id not in (
        'dba58d03-b8ec-4579-913c-0ec2e6375e3d'::uuid,
        'ee0830af-36f7-4a06-beee-d59ae7ae8d1b'::uuid,
        '2a3a6d7c-e96f-4fd3-8dc5-867675c71dc6'::uuid
      )
  ) then
    raise exception 'Another canonical Field Row weeding task remains visible outside the active batch.';
  end if;
end;
$validation$;
