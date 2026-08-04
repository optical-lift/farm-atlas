create or replace function atlas.is_retired_growing_object_v1(p_object_id text)
returns boolean
language sql
stable
set search_path = atlas, public
as $$
  select exists (
    select 1
    from atlas.growing_objects go
    where go.id::text = p_object_id
      and (
        go.object_mode = 'historical_tombstone'
        or lower(coalesce(go.metadata ->> 'canonicalDeleted', 'false')) = 'true'
        or lower(coalesce(go.metadata ->> 'subjectRetired', 'false')) = 'true'
      )
  );
$$;

create or replace function atlas.guard_retired_object_task_v1()
returns trigger
language plpgsql
set search_path = atlas, public
as $$
declare
  v_target_object_id text;
begin
  v_target_object_id := new.metadata #>> '{target_object_id}';
  if v_target_object_id is not null and atlas.is_retired_growing_object_v1(v_target_object_id) then
    new.status := 'archived';
    new.assigned_membership_id := null;
    new.assigned_user_id := null;
    new.visibility_scope := 'system_internal';
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'retired_object_suppressed', true,
      'retired_object_suppressed_at', now(),
      'retired_object_id', v_target_object_id,
      'retired_object_guard', 'guard_retired_objects_from_task_release_v1'
    );
    new.note := concat_ws(E'\n', nullif(new.note, ''), 'System archived: the target farm object is retired and cannot produce worker tasks.');
  end if;
  return new;
end;
$$;

drop trigger if exists guard_retired_object_task_v1 on atlas.tasks;
create trigger guard_retired_object_task_v1
before insert or update on atlas.tasks
for each row execute function atlas.guard_retired_object_task_v1();

create or replace function atlas.guard_retired_object_task_link_v1()
returns trigger
language plpgsql
set search_path = atlas, public
as $$
begin
  if atlas.is_retired_growing_object_v1(new.object_id::text) then
    update atlas.tasks
    set status = 'archived',
        assigned_membership_id = null,
        assigned_user_id = null,
        visibility_scope = 'system_internal',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'retired_object_suppressed', true,
          'retired_object_suppressed_at', now(),
          'retired_object_id', new.object_id,
          'retired_object_guard', 'guard_retired_objects_from_task_release_v1'
        ),
        note = concat_ws(E'\n', nullif(note, ''), 'System archived: linked farm object is retired and cannot produce worker tasks.'),
        updated_at = now()
    where id = new.task_id;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_retired_object_task_link_v1 on atlas.task_objects;
create trigger guard_retired_object_task_link_v1
before insert or update on atlas.task_objects
for each row execute function atlas.guard_retired_object_task_link_v1();

create or replace function atlas.guard_retired_object_rhythm_binding_v1()
returns trigger
language plpgsql
set search_path = atlas, public
as $$
begin
  if new.subject_kind = 'growing_object'
     and new.subject_id is not null
     and atlas.is_retired_growing_object_v1(new.subject_id::text) then
    new.active := false;
    new.active_until := case
      when new.active_from is null or now() > new.active_from then now()
      else new.active_from + interval '1 second'
    end;
    new.owner_reason := concat_ws(' ', nullif(new.owner_reason, ''), 'Disabled automatically because the subject is a retired historical object.');
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'retired_object_suppressed', true,
      'retired_object_suppressed_at', now(),
      'retired_object_guard', 'guard_retired_objects_from_task_release_v1'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists guard_retired_object_rhythm_binding_v1 on atlas.rhythm_bindings;
create trigger guard_retired_object_rhythm_binding_v1
before insert or update on atlas.rhythm_bindings
for each row execute function atlas.guard_retired_object_rhythm_binding_v1();

create or replace function atlas.guard_retired_object_rhythm_state_v1()
returns trigger
language plpgsql
set search_path = atlas, public
as $$
begin
  if new.subject_kind = 'growing_object'
     and new.subject_id is not null
     and atlas.is_retired_growing_object_v1(new.subject_id::text) then
    new.state := 'paused';
    new.warning_at := null;
    new.due_at := null;
    new.failure_at := null;
    new.current_task_id := null;
    new.current_occurrence_id := null;
    new.visibility_scope := 'system_internal';
    new.state_reason := coalesce(new.state_reason, '{}'::jsonb) || jsonb_build_object(
      'reason', 'retired_subject',
      'guard', 'guard_retired_objects_from_task_release_v1'
    );
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'subjectRetired', true,
      'retired_object_suppressed', true,
      'retired_object_suppressed_at', now(),
      'retired_object_guard', 'guard_retired_objects_from_task_release_v1'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists guard_retired_object_rhythm_state_v1 on atlas.rhythm_state;
create trigger guard_retired_object_rhythm_state_v1
before insert or update on atlas.rhythm_state
for each row execute function atlas.guard_retired_object_rhythm_state_v1();

create or replace function atlas.guard_retired_object_occurrence_v1()
returns trigger
language plpgsql
set search_path = atlas, public
as $$
declare
  v_target_object_id text;
begin
  v_target_object_id := new.task_payload #>> '{metadata,target_object_id}';
  if v_target_object_id is not null and atlas.is_retired_growing_object_v1(v_target_object_id) then
    new.state := 'cancelled';
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'retired_object_suppressed', true,
      'retired_object_suppressed_at', now(),
      'retired_object_id', v_target_object_id,
      'retired_object_guard', 'guard_retired_objects_from_task_release_v1'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists guard_retired_object_occurrence_v1 on atlas.planned_work_occurrences;
create trigger guard_retired_object_occurrence_v1
before insert or update on atlas.planned_work_occurrences
for each row execute function atlas.guard_retired_object_occurrence_v1();

update atlas.rhythm_bindings rb
set active = false,
    active_until = case when rb.active_from is null or now() > rb.active_from then now() else rb.active_from + interval '1 second' end,
    owner_reason = concat_ws(' ', nullif(rb.owner_reason, ''), 'Disabled because the subject is a retired historical object.'),
    metadata = coalesce(rb.metadata, '{}'::jsonb) || jsonb_build_object('retired_object_suppressed', true, 'retired_object_suppressed_at', now(), 'retired_object_guard', 'guard_retired_objects_from_task_release_v1'),
    updated_at = now()
where rb.subject_kind = 'growing_object'
  and atlas.is_retired_growing_object_v1(rb.subject_id::text);

update atlas.rhythm_state rs
set state = 'paused', warning_at = null, due_at = null, failure_at = null,
    current_task_id = null, current_occurrence_id = null, visibility_scope = 'system_internal',
    state_reason = coalesce(rs.state_reason, '{}'::jsonb) || jsonb_build_object('reason', 'retired_subject', 'guard', 'guard_retired_objects_from_task_release_v1'),
    metadata = coalesce(rs.metadata, '{}'::jsonb) || jsonb_build_object('subjectRetired', true, 'retired_object_suppressed', true, 'retired_object_suppressed_at', now(), 'retired_object_guard', 'guard_retired_objects_from_task_release_v1'),
    updated_at = now()
where rs.subject_kind = 'growing_object'
  and atlas.is_retired_growing_object_v1(rs.subject_id::text);

update atlas.planned_work_occurrences pwo
set state = 'cancelled',
    metadata = coalesce(pwo.metadata, '{}'::jsonb) || jsonb_build_object('retired_object_suppressed', true, 'retired_object_suppressed_at', now(), 'retired_object_guard', 'guard_retired_objects_from_task_release_v1'),
    updated_at = now()
where exists (
  select 1 from atlas.growing_objects go
  where atlas.is_retired_growing_object_v1(go.id::text)
    and (
      pwo.task_payload #>> '{metadata,target_object_id}' = go.id::text
      or exists (
        select 1 from jsonb_array_elements(coalesce(pwo.relation_payload -> 'task_objects', '[]'::jsonb)) rel
        where rel ->> 'object_id' = go.id::text
      )
    )
);

update atlas.tasks t
set status = 'archived', assigned_membership_id = null, assigned_user_id = null,
    visibility_scope = 'system_internal',
    metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object('retired_object_suppressed', true, 'retired_object_suppressed_at', now(), 'retired_object_guard', 'guard_retired_objects_from_task_release_v1'),
    note = concat_ws(E'\n', nullif(t.note, ''), 'System archived: retired historical object cannot produce worker tasks.'),
    updated_at = now()
where exists (
  select 1 from atlas.growing_objects go
  where atlas.is_retired_growing_object_v1(go.id::text)
    and (
      t.metadata #>> '{target_object_id}' = go.id::text
      or exists (select 1 from atlas.task_objects t_o where t_o.task_id = t.id and t_o.object_id = go.id)
    )
);

update atlas.weed_cards wc
set next_review_on = null,
    metadata = coalesce(wc.metadata, '{}'::jsonb) || jsonb_build_object('retired', true, 'retiredAt', now(), 'retiredReason', 'Target growing object is a historical tombstone.', 'retired_object_guard', 'guard_retired_objects_from_task_release_v1'),
    updated_at = now()
where atlas.is_retired_growing_object_v1(wc.object_id::text);

update atlas.maintenance_objects mo
set active = false,
    metadata = coalesce(mo.metadata, '{}'::jsonb) || jsonb_build_object('retired', true, 'retiredAt', now(), 'retiredReason', 'Target growing object is a historical tombstone.', 'retired_object_guard', 'guard_retired_objects_from_task_release_v1'),
    updated_at = now()
where atlas.is_retired_growing_object_v1(mo.object_id::text);

update atlas.weed_passes wp
set status = 'closed', closed_at = coalesce(wp.closed_at, now()),
    metadata = coalesce(wp.metadata, '{}'::jsonb) || jsonb_build_object('closedReason', 'Target growing object is a historical tombstone.', 'retired_object_guard', 'guard_retired_objects_from_task_release_v1'),
    updated_at = now()
where wp.status = 'active'
  and exists (select 1 from atlas.weed_cards wc where wc.id = wp.weed_card_id and atlas.is_retired_growing_object_v1(wc.object_id::text));

update atlas.task_release_queue_items q
set state = 'skipped', completed_at = coalesce(q.completed_at, now()),
    metadata = coalesce(q.metadata, '{}'::jsonb) || jsonb_build_object('skippedReason', 'Target growing object is a historical tombstone.', 'retired_object_guard', 'guard_retired_objects_from_task_release_v1'),
    updated_at = now()
where q.state in ('active', 'queued')
  and (
    exists (select 1 from atlas.maintenance_objects mo where mo.id = q.maintenance_object_id and atlas.is_retired_growing_object_v1(mo.object_id::text))
    or exists (select 1 from atlas.tasks t join atlas.task_objects t_o on t_o.task_id = t.id where t.id = q.task_id and atlas.is_retired_growing_object_v1(t_o.object_id::text))
  );