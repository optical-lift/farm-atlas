-- Build 1: canonical Journal event contract and prepared Day read shape.
-- This is additive foundation only. It does not change the current Home or Day UI.

create table if not exists atlas.journal_event_index (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  source_workflow_event_id uuid unique references atlas.workflow_events(id) on delete cascade,
  event_key text not null,
  event_kind text not null check (event_kind in (
    'task_result',
    'field_log',
    'field_action',
    'observation',
    'maintenance_result',
    'state_change',
    'crop_cycle_change',
    'production_change',
    'trail_evidence',
    'unlock',
    'rhythm_warning',
    'rhythm_due',
    'rhythm_failure',
    'rhythm_recovery',
    'migration',
    'owner_action',
    'system_event'
  )),
  source_kind text not null,
  source_id uuid not null,
  source_event text not null,
  occurred_at timestamptz not null,
  journal_date date not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  assigned_user_id uuid references auth.users(id) on delete set null,
  task_id uuid references atlas.tasks(id) on delete set null,
  object_id uuid references atlas.growing_objects(id) on delete set null,
  crop_cycle_id uuid references atlas.crop_cycles(id) on delete set null,
  project_id uuid references atlas.projects(id) on delete set null,
  trail_binding_id uuid references atlas.trail_bindings(id) on delete set null,
  title text not null,
  detail text,
  visibility_scope text not null default 'farm_shared' check (visibility_scope in (
    'owner',
    'management',
    'assigned_worker',
    'farm_shared',
    'project_shared',
    'system_internal'
  )),
  importance text not null default 'normal' check (importance in ('quiet','normal','attention','critical')),
  payload jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, event_key),
  unique (source_kind, source_id, source_event, event_key)
);

comment on table atlas.journal_event_index is
  'Prepared, provenance-preserving Journal read index. Canonical task, result, state, Trail, and Clock records remain authoritative.';
comment on column atlas.journal_event_index.event_key is
  'Stable idempotency key for one canonical event representation.';
comment on column atlas.journal_event_index.provenance is
  'Source table, source row, source event, and adapter version. This index never replaces canonical records.';

create index if not exists journal_event_index_farm_day_idx
  on atlas.journal_event_index(farm_id, journal_date, occurred_at, id);
create index if not exists journal_event_index_kind_idx
  on atlas.journal_event_index(farm_id, event_kind, journal_date desc);
create index if not exists journal_event_index_task_idx
  on atlas.journal_event_index(task_id, occurred_at desc)
  where task_id is not null;
create index if not exists journal_event_index_object_idx
  on atlas.journal_event_index(object_id, occurred_at desc)
  where object_id is not null;
create index if not exists journal_event_index_project_idx
  on atlas.journal_event_index(project_id, occurred_at desc)
  where project_id is not null;

alter table atlas.journal_event_index enable row level security;

create or replace function atlas.classify_journal_event_v1(
  p_source_kind text,
  p_source_event text
)
returns text
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select case
    when lower(coalesce(p_source_event, '')) like '%unlock%'
      or lower(coalesce(p_source_event, '')) like '%release%' then 'unlock'
    when p_source_kind = 'task' then 'task_result'
    when p_source_kind = 'field_log' and lower(coalesce(p_source_event, '')) = 'logged' then 'field_log'
    when p_source_kind = 'field_log' then 'field_action'
    when p_source_kind = 'object' then 'observation'
    when p_source_kind = 'maintenance' then 'maintenance_result'
    when p_source_kind = 'crop_cycle' then 'crop_cycle_change'
    when p_source_kind = 'production_succession' then 'production_change'
    else 'system_event'
  end;
$$;

revoke all on function atlas.classify_journal_event_v1(text, text) from public, anon;
grant execute on function atlas.classify_journal_event_v1(text, text) to authenticated;

create or replace function atlas.can_read_journal_event_v1(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select coalesce((
    select case e.visibility_scope
      when 'owner' then atlas.is_farm_owner(e.farm_id)
      when 'management' then atlas.is_farm_manager_or_owner(e.farm_id)
      when 'assigned_worker' then
        atlas.is_farm_manager_or_owner(e.farm_id)
        or e.assigned_user_id = auth.uid()
      when 'project_shared' then
        e.project_id is not null and atlas.can_read_project(e.project_id)
      when 'system_internal' then atlas.is_farm_owner(e.farm_id)
      else atlas.is_farm_member(e.farm_id)
    end
    from atlas.journal_event_index e
    where e.id = p_event_id
  ), false);
$$;

revoke all on function atlas.can_read_journal_event_v1(uuid) from public, anon;
grant execute on function atlas.can_read_journal_event_v1(uuid) to authenticated;

drop policy if exists journal_event_index_read_visible on atlas.journal_event_index;
create policy journal_event_index_read_visible on atlas.journal_event_index
for select to authenticated
using (atlas.can_read_journal_event_v1(id));

grant select on atlas.journal_event_index to authenticated;
revoke insert, update, delete, truncate, references, trigger on atlas.journal_event_index from authenticated, anon;
revoke all on atlas.journal_event_index from anon;

create or replace function atlas.upsert_journal_event_v1(
  p_organization_id uuid,
  p_farm_id uuid,
  p_event_key text,
  p_event_kind text,
  p_source_kind text,
  p_source_id uuid,
  p_source_event text,
  p_occurred_at timestamptz,
  p_journal_date date,
  p_title text,
  p_detail text default null,
  p_visibility_scope text default 'farm_shared',
  p_importance text default 'normal',
  p_actor_user_id uuid default null,
  p_assigned_user_id uuid default null,
  p_task_id uuid default null,
  p_object_id uuid default null,
  p_crop_cycle_id uuid default null,
  p_project_id uuid default null,
  p_trail_binding_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_provenance jsonb default '{}'::jsonb,
  p_source_workflow_event_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_event_id uuid;
  v_farm_organization_id uuid;
begin
  if p_organization_id is null or p_farm_id is null or p_source_id is null then
    raise exception 'Journal event requires organization, farm, and source ids.' using errcode = '22023';
  end if;

  select f.organization_id into v_farm_organization_id
  from atlas.farms f
  where f.id = p_farm_id;

  if v_farm_organization_id is null or v_farm_organization_id <> p_organization_id then
    raise exception 'Journal event organization does not own the farm.' using errcode = '23503';
  end if;

  if nullif(btrim(p_event_key), '') is null
     or nullif(btrim(p_source_kind), '') is null
     or nullif(btrim(p_source_event), '') is null
     or nullif(btrim(p_title), '') is null then
    raise exception 'Journal event key, source, source event, and title are required.' using errcode = '22023';
  end if;

  insert into atlas.journal_event_index (
    organization_id,
    farm_id,
    source_workflow_event_id,
    event_key,
    event_kind,
    source_kind,
    source_id,
    source_event,
    occurred_at,
    journal_date,
    actor_user_id,
    assigned_user_id,
    task_id,
    object_id,
    crop_cycle_id,
    project_id,
    trail_binding_id,
    title,
    detail,
    visibility_scope,
    importance,
    payload,
    provenance
  ) values (
    p_organization_id,
    p_farm_id,
    p_source_workflow_event_id,
    left(btrim(p_event_key), 240),
    p_event_kind,
    lower(btrim(p_source_kind)),
    p_source_id,
    lower(btrim(p_source_event)),
    coalesce(p_occurred_at, now()),
    coalesce(p_journal_date, (coalesce(p_occurred_at, now()) at time zone 'America/Chicago')::date),
    p_actor_user_id,
    p_assigned_user_id,
    p_task_id,
    p_object_id,
    p_crop_cycle_id,
    p_project_id,
    p_trail_binding_id,
    btrim(p_title),
    nullif(btrim(coalesce(p_detail, '')), ''),
    p_visibility_scope,
    p_importance,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_provenance, '{}'::jsonb)
  )
  on conflict (farm_id, event_key) do update
    set event_kind = excluded.event_kind,
        source_event = excluded.source_event,
        occurred_at = excluded.occurred_at,
        journal_date = excluded.journal_date,
        actor_user_id = excluded.actor_user_id,
        assigned_user_id = excluded.assigned_user_id,
        task_id = excluded.task_id,
        object_id = excluded.object_id,
        crop_cycle_id = excluded.crop_cycle_id,
        project_id = excluded.project_id,
        trail_binding_id = excluded.trail_binding_id,
        title = excluded.title,
        detail = excluded.detail,
        visibility_scope = excluded.visibility_scope,
        importance = excluded.importance,
        payload = excluded.payload,
        provenance = excluded.provenance,
        source_workflow_event_id = excluded.source_workflow_event_id,
        updated_at = now()
  returning id into v_event_id;

  return v_event_id;
end;
$$;

-- Internal adapter only. Canonical writers and later Clock functions may call it,
-- but clients cannot manufacture Journal history.
revoke all on function atlas.upsert_journal_event_v1(
  uuid, uuid, text, text, text, uuid, text, timestamptz, date, text, text,
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid
) from public, anon, authenticated;

create or replace function atlas.index_workflow_event_v1(p_workflow_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_workflow atlas.workflow_events%rowtype;
  v_organization_id uuid;
  v_event_kind text;
  v_title text;
  v_detail text;
  v_visibility_scope text := 'farm_shared';
  v_importance text := 'normal';
  v_actor_user_id uuid;
  v_assigned_user_id uuid;
  v_task_id uuid;
  v_object_id uuid;
  v_crop_cycle_id uuid;
  v_project_id uuid;
  v_event_id uuid;
begin
  select * into v_workflow
  from atlas.workflow_events
  where id = p_workflow_event_id;

  if v_workflow.id is null then
    raise exception 'Workflow event not found.' using errcode = 'P0002';
  end if;

  select f.organization_id into v_organization_id
  from atlas.farms f
  where f.id = v_workflow.farm_id;

  v_event_kind := atlas.classify_journal_event_v1(v_workflow.source_kind, v_workflow.source_event);
  v_title := initcap(replace(v_workflow.source_event, '_', ' '));

  if v_workflow.source_kind = 'task' then
    select
      t.id,
      t.title,
      t.visibility_scope,
      t.assigned_user_id,
      ptl.project_id
    into
      v_task_id,
      v_title,
      v_visibility_scope,
      v_assigned_user_id,
      v_project_id
    from atlas.tasks t
    left join lateral (
      select link.project_id
      from atlas.project_task_links link
      where link.task_id = t.id
      order by link.created_at
      limit 1
    ) ptl on true
    where t.id = v_workflow.source_id;

    if v_visibility_scope = 'project_shared' and v_project_id is null then
      v_visibility_scope := 'management';
    end if;

    select tr.actor_user_id, coalesce(tr.note, tr.reason)
    into v_actor_user_id, v_detail
    from atlas.task_transitions tr
    where tr.task_outcome_event_id = nullif(v_workflow.payload ->> 'task_outcome_event_id', '')::uuid
    order by tr.created_at desc
    limit 1;

    v_importance := case
      when v_workflow.source_event = 'blocked' then 'attention'
      when v_workflow.source_event in ('done','partial','changed_plan','rescheduled','reopened') then 'normal'
      else 'quiet'
    end;
  elsif v_workflow.source_kind = 'field_log' then
    select
      coalesce(nullif(fl.summary_sentence, ''), v_title),
      fl.note,
      fl.actor_user_id
    into v_title, v_detail, v_actor_user_id
    from atlas.field_logs fl
    where fl.id = v_workflow.source_id;
  elsif v_workflow.source_kind = 'object' then
    v_object_id := v_workflow.source_id;
    select coalesce(nullif(o.label, ''), v_title)
    into v_title
    from atlas.growing_objects o
    where o.id = v_workflow.source_id;
  elsif v_workflow.source_kind = 'crop_cycle' then
    v_crop_cycle_id := v_workflow.source_id;
    select coalesce(nullif(cc.crop_label, ''), v_title), cc.object_id
    into v_title, v_object_id
    from atlas.crop_cycles cc
    where cc.id = v_workflow.source_id;
  elsif v_workflow.source_kind = 'maintenance' then
    select mo.object_id
    into v_object_id
    from atlas.maintenance_objects mo
    where mo.id = v_workflow.source_id;
  end if;

  v_title := coalesce(
    nullif(v_workflow.payload ->> 'task_title', ''),
    nullif(v_workflow.payload ->> 'action_type', ''),
    nullif(v_title, ''),
    initcap(replace(v_workflow.source_event, '_', ' '))
  );

  v_event_id := atlas.upsert_journal_event_v1(
    p_organization_id => v_organization_id,
    p_farm_id => v_workflow.farm_id,
    p_event_key => 'workflow:' || v_workflow.event_key,
    p_event_kind => v_event_kind,
    p_source_kind => v_workflow.source_kind,
    p_source_id => v_workflow.source_id,
    p_source_event => v_workflow.source_event,
    p_occurred_at => v_workflow.created_at,
    p_journal_date => v_workflow.event_date,
    p_title => v_title,
    p_detail => v_detail,
    p_visibility_scope => coalesce(v_visibility_scope, 'farm_shared'),
    p_importance => v_importance,
    p_actor_user_id => v_actor_user_id,
    p_assigned_user_id => v_assigned_user_id,
    p_task_id => v_task_id,
    p_object_id => v_object_id,
    p_crop_cycle_id => v_crop_cycle_id,
    p_project_id => v_project_id,
    p_payload => v_workflow.payload,
    p_provenance => jsonb_build_object(
      'adapter', 'workflow_event_index_v1',
      'source_table', 'atlas.workflow_events',
      'workflow_event_id', v_workflow.id,
      'workflow_event_key', v_workflow.event_key,
      'canonical_source_kind', v_workflow.source_kind,
      'canonical_source_id', v_workflow.source_id,
      'canonical_source_event', v_workflow.source_event
    ),
    p_source_workflow_event_id => v_workflow.id
  );

  return v_event_id;
end;
$$;

revoke all on function atlas.index_workflow_event_v1(uuid) from public, anon, authenticated;

create or replace function atlas.sync_workflow_event_to_journal_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.index_workflow_event_v1(new.id);
  return new;
end;
$$;

revoke all on function atlas.sync_workflow_event_to_journal_v1() from public, anon, authenticated;

drop trigger if exists workflow_events_journal_index_v1 on atlas.workflow_events;
create trigger workflow_events_journal_index_v1
after insert or update of source_event, event_date, payload on atlas.workflow_events
for each row execute function atlas.sync_workflow_event_to_journal_v1();

create or replace function atlas.can_read_task_in_journal_v1(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select coalesce((
    select case t.visibility_scope
      when 'owner' then t.farm_id is not null and atlas.is_farm_owner(t.farm_id)
      when 'management' then t.farm_id is not null and atlas.is_farm_manager_or_owner(t.farm_id)
      when 'assigned_worker' then
        (t.farm_id is not null and atlas.is_farm_manager_or_owner(t.farm_id))
        or t.assigned_user_id = auth.uid()
      when 'project_shared' then exists (
        select 1
        from atlas.project_task_links ptl
        where ptl.task_id = t.id
          and atlas.can_read_project(ptl.project_id)
      )
      when 'system_internal' then t.farm_id is not null and atlas.is_farm_owner(t.farm_id)
      else t.farm_id is not null and atlas.is_farm_member(t.farm_id)
    end
    from atlas.tasks t
    where t.id = p_task_id
  ), false);
$$;

revoke all on function atlas.can_read_task_in_journal_v1(uuid) from public, anon;
grant execute on function atlas.can_read_task_in_journal_v1(uuid) to authenticated;

create or replace function atlas.journal_day_v1(
  p_farm_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'America/Chicago')::date);
  v_has_scope boolean;
  v_carried jsonb;
  v_planned jsonb;
  v_events jsonb;
  v_unlocks jsonb;
  v_open_count integer;
  v_done_count integer;
  v_event_count integer;
begin
  select
    atlas.is_farm_member(f.id)
    or atlas.is_organization_member(f.organization_id)
  into v_has_scope
  from atlas.farms f
  where f.id = p_farm_id;

  if not coalesce(v_has_scope, false) then
    raise exception 'Farm Journal access is required.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', t.id,
    'title', t.title,
    'status', t.status,
    'dueDate', t.due_date,
    'taskType', t.task_type,
    'workClass', t.work_class,
    'priority', t.priority,
    'zoneId', t.zone_id
  ) order by t.due_date, t.priority desc, t.created_at), '[]'::jsonb)
  into v_carried
  from atlas.tasks t
  where t.farm_id = p_farm_id
    and t.due_date < v_day
    and t.status in ('open','blocked')
    and atlas.can_read_task_in_journal_v1(t.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', t.id,
    'title', t.title,
    'status', t.status,
    'dueDate', t.due_date,
    'taskType', t.task_type,
    'workClass', t.work_class,
    'priority', t.priority,
    'zoneId', t.zone_id
  ) order by t.priority desc, t.created_at), '[]'::jsonb)
  into v_planned
  from atlas.tasks t
  where t.farm_id = p_farm_id
    and t.due_date = v_day
    and t.status <> 'archived'
    and atlas.can_read_task_in_journal_v1(t.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', e.id,
    'eventKey', e.event_key,
    'eventKind', e.event_kind,
    'sourceKind', e.source_kind,
    'sourceId', e.source_id,
    'sourceEvent', e.source_event,
    'occurredAt', e.occurred_at,
    'journalDate', e.journal_date,
    'title', e.title,
    'detail', e.detail,
    'importance', e.importance,
    'taskId', e.task_id,
    'objectId', e.object_id,
    'cropCycleId', e.crop_cycle_id,
    'projectId', e.project_id,
    'trailBindingId', e.trail_binding_id,
    'provenance', e.provenance
  ) order by e.occurred_at, e.id), '[]'::jsonb)
  into v_events
  from atlas.journal_event_index e
  where e.farm_id = p_farm_id
    and e.journal_date = v_day
    and atlas.can_read_journal_event_v1(e.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', e.id,
    'eventKey', e.event_key,
    'title', e.title,
    'occurredAt', e.occurred_at,
    'taskId', e.task_id,
    'projectId', e.project_id,
    'trailBindingId', e.trail_binding_id
  ) order by e.occurred_at, e.id), '[]'::jsonb)
  into v_unlocks
  from atlas.journal_event_index e
  where e.farm_id = p_farm_id
    and e.journal_date = v_day
    and e.event_kind = 'unlock'
    and atlas.can_read_journal_event_v1(e.id);

  select count(*) filter (where t.status in ('open','blocked')),
         count(*) filter (where t.status = 'done')
  into v_open_count, v_done_count
  from atlas.tasks t
  where t.farm_id = p_farm_id
    and t.due_date = v_day
    and atlas.can_read_task_in_journal_v1(t.id);

  select count(*) into v_event_count
  from atlas.journal_event_index e
  where e.farm_id = p_farm_id
    and e.journal_date = v_day
    and atlas.can_read_journal_event_v1(e.id);

  return jsonb_build_object(
    'contractVersion', 'journal_day_v1',
    'farmId', p_farm_id,
    'date', v_day,
    'carried', v_carried,
    'planned', v_planned,
    'events', v_events,
    'unlocks', v_unlocks,
    'summary', jsonb_build_object(
      'open', coalesce(v_open_count, 0),
      'done', coalesce(v_done_count, 0),
      'events', coalesce(v_event_count, 0),
      'unlocks', jsonb_array_length(v_unlocks)
    )
  );
end;
$$;

revoke all on function atlas.journal_day_v1(uuid, date) from public, anon;
grant execute on function atlas.journal_day_v1(uuid, date) to authenticated;

-- Backfill the prepared index from the existing canonical workflow envelope.
-- This only projects existing facts; it does not manufacture completion or observation.
do $$
declare
  v_row record;
begin
  for v_row in
    select w.id
    from atlas.workflow_events w
    order by w.created_at, w.id
  loop
    perform atlas.index_workflow_event_v1(v_row.id);
  end loop;
end;
$$;
