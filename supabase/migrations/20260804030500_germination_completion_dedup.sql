-- Germination is a crop-cycle milestone. Once the crop cycle records germination,
-- every equivalent active check must leave the work surface, even when an older
-- task family stored the crop-cycle identity only in metadata.

create or replace function atlas.is_germination_task_v1(p_task atlas.tasks)
returns boolean
language sql
immutable
set search_path = pg_catalog, atlas
as $$
  select
    coalesce(p_task.task_type = 'germination_check', false)
    or coalesce(p_task.action_key = 'germination_check', false)
    or coalesce(p_task.metadata ->> 'task_style' = 'germination_check', false)
    or coalesce(p_task.metadata ->> 'milestone' = 'germination_check', false);
$$;

create or replace function atlas.germination_task_crop_cycle_id_v1(p_task atlas.tasks)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_cycle_id uuid;
begin
  if p_task.generated_from = 'crop_cycle_milestone'
     and p_task.generated_from_id is not null then
    return p_task.generated_from_id;
  end if;

  v_cycle_id := atlas.rhythm_safe_uuid_v1(p_task.metadata ->> 'crop_cycle_id');
  if v_cycle_id is not null then
    return v_cycle_id;
  end if;

  select tcc.crop_cycle_id
  into v_cycle_id
  from atlas.task_crop_cycles tcc
  where tcc.task_id = p_task.id
  order by
    case tcc.role when 'observes' then 0 when 'affects' then 1 else 2 end,
    case tcc.confidence when 'confirmed' then 0 else 1 end,
    tcc.created_at
  limit 1;

  return v_cycle_id;
end;
$$;

create or replace function atlas.archive_resolved_germination_tasks_v1(
  p_crop_cycle_id uuid,
  p_keep_task_id uuid default null,
  p_reason text default 'Germination already recorded for crop cycle'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_count integer := 0;
begin
  if p_crop_cycle_id is null then
    return 0;
  end if;

  update atlas.tasks task
  set status = 'archived',
      metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'archived_reason', p_reason,
        'canonical_crop_cycle_id', p_crop_cycle_id,
        'canonical_germination_task_id', p_keep_task_id,
        'germination_resolution_guard', 'crop_cycle_state_v1',
        'archived_at', now()
      )),
      updated_at = now()
  where task.status in ('open', 'blocked')
    and task.id is distinct from p_keep_task_id
    and atlas.is_germination_task_v1(task)
    and atlas.germination_task_crop_cycle_id_v1(task) = p_crop_cycle_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function atlas.collapse_new_germination_duplicate_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_key text;
  v_cycle_id uuid;
  v_cycle atlas.crop_cycles%rowtype;
  v_canonical atlas.tasks%rowtype;
  v_new_is_canonical boolean := false;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.status not in ('open', 'blocked') then
    return new;
  end if;
  if not atlas.is_germination_task_v1(new) then
    return new;
  end if;

  v_cycle_id := atlas.germination_task_crop_cycle_id_v1(new);

  if v_cycle_id is not null then
    select * into v_cycle
    from atlas.crop_cycles
    where id = v_cycle_id;

    if v_cycle.id is not null
       and (v_cycle.germination_checked_date is not null or v_cycle.cycle_state = 'germinated') then
      perform atlas.archive_resolved_germination_tasks_v1(
        v_cycle_id,
        null,
        'Germination already recorded for crop cycle'
      );
      return new;
    end if;

    select task.* into v_canonical
    from atlas.tasks task
    where task.id <> new.id
      and task.farm_id = new.farm_id
      and task.status in ('open', 'blocked', 'done')
      and atlas.is_germination_task_v1(task)
      and atlas.germination_task_crop_cycle_id_v1(task) = v_cycle_id
    order by
      case when task.status = 'done' then 0 else 1 end,
      case when task.generated_from = 'crop_cycle_milestone' then 0 else 1 end,
      task.created_at,
      task.id
    limit 1;

    if v_canonical.id is not null then
      v_new_is_canonical := new.generated_from = 'crop_cycle_milestone'
        and v_canonical.status in ('open', 'blocked')
        and v_canonical.generated_from is distinct from 'crop_cycle_milestone';

      if v_new_is_canonical then
        perform atlas.archive_resolved_germination_tasks_v1(
          v_cycle_id,
          new.id,
          'Duplicate germination event for crop cycle'
        );
      else
        update atlas.tasks
        set status = 'archived',
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
              'archived_reason', case
                when v_canonical.status = 'done' then 'Germination already recorded for crop cycle'
                else 'Duplicate germination event for crop cycle'
              end,
              'canonical_crop_cycle_id', v_cycle_id,
              'canonical_germination_task_id', v_canonical.id,
              'germination_resolution_guard', 'crop_cycle_identity_v1',
              'archived_at', now()
            ),
            updated_at = now()
        where id = new.id;
      end if;
      return new;
    end if;
  end if;

  -- Legacy fallback for checks that genuinely have no crop-cycle identity yet.
  v_key := atlas.germination_variety_key_v1(new.metadata, new.title);

  select task.* into v_canonical
  from atlas.tasks task
  where task.id <> new.id
    and task.farm_id = new.farm_id
    and task.status in ('open', 'blocked')
    and task.due_date is not distinct from new.due_date
    and atlas.is_germination_task_v1(task)
    and atlas.germination_variety_key_v1(task.metadata, task.title) = v_key
  order by
    case when task.generated_from = 'crop_cycle_milestone' then 0 else 1 end,
    task.created_at,
    task.id
  limit 1;

  if v_canonical.id is not null then
    update atlas.tasks
    set status = 'archived',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'archived_reason', 'Duplicate germination event for same variety and due date',
          'canonical_germination_task_id', v_canonical.id,
          'germination_resolution_guard', 'legacy_variety_due_date_v1',
          'archived_at', now()
        ),
        updated_at = now()
    where id = new.id;
  else
    update atlas.tasks
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'germination_variety_key', v_key,
          'collection_member_key', 'germination:' || v_key || ':' || coalesce(due_date::text, 'open')
        ),
        updated_at = now()
    where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_collapse_new_germination_duplicate_v1 on atlas.tasks;
create trigger trg_collapse_new_germination_duplicate_v1
after insert or update of status, generated_from, generated_from_id, metadata, action_key, task_type
on atlas.tasks
for each row
execute function atlas.collapse_new_germination_duplicate_v1();

create or replace function atlas.archive_germination_tasks_when_cycle_resolves_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  if new.germination_checked_date is not null
     and (
       old.germination_checked_date is distinct from new.germination_checked_date
       or old.cycle_state is distinct from new.cycle_state
     ) then
    perform atlas.archive_resolved_germination_tasks_v1(
      new.id,
      null,
      'Germination already recorded for crop cycle'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists crop_cycles_archive_resolved_germination_tasks_v1 on atlas.crop_cycles;
create trigger crop_cycles_archive_resolved_germination_tasks_v1
after update of germination_checked_date, cycle_state
on atlas.crop_cycles
for each row
execute function atlas.archive_germination_tasks_when_cycle_resolves_v1();

-- Repair any active duplicate left behind by older task families. This is based on
-- canonical crop-cycle state and does not name a farm, task, crop, or generated id.
update atlas.tasks task
set status = 'archived',
    metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
      'archived_reason', 'Germination already recorded for crop cycle',
      'canonical_crop_cycle_id', atlas.germination_task_crop_cycle_id_v1(task),
      'germination_resolution_guard', 'migration_repair_v1',
      'archived_at', now()
    ),
    updated_at = now()
where task.status in ('open', 'blocked')
  and atlas.is_germination_task_v1(task)
  and exists (
    select 1
    from atlas.crop_cycles cycle
    where cycle.id = atlas.germination_task_crop_cycle_id_v1(task)
      and cycle.germination_checked_date is not null
  );
