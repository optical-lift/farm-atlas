-- A task due date and its released planned-work occurrence are two lenses over
-- one current schedule. Canonical transition writes and Sunday guardrails already
-- synchronize that pair. This closes the remaining path: a direct, explicit due
-- date edit on an already-released active task.

create or replace function atlas.sync_active_task_due_date_occurrence_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_occurrence_id uuid;
begin
  if new.status not in ('open','blocked')
     or new.due_date is null
     or new.due_date is not distinct from old.due_date
     or coalesce(new.metadata->>'planned_occurrence_date_role','')='historical_release_provenance' then
    return new;
  end if;

  v_occurrence_id:=coalesce(
    new.planned_occurrence_id,
    case
      when nullif(new.metadata->>'planned_occurrence_id','') ~* '^[0-9a-f-]{36}$'
      then (new.metadata->>'planned_occurrence_id')::uuid
      else null
    end
  );

  if v_occurrence_id is null then
    return new;
  end if;

  update atlas.planned_work_occurrences occurrence
  set planned_due_date=new.due_date,
      not_before_date=case
        when occurrence.not_before_date is null
          or occurrence.not_before_date=occurrence.planned_due_date
          or occurrence.not_before_date=old.due_date
        then new.due_date
        else occurrence.not_before_date
      end,
      metadata=coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
        'active_task_due_date_sync',jsonb_build_object(
          'task_id',new.id,
          'previous_due_date',old.due_date,
          'target_date',new.due_date,
          'synced_at',now()
        )
      ),
      updated_at=now()
  where occurrence.id=v_occurrence_id
    and occurrence.farm_id=new.farm_id
    and occurrence.released_task_id=new.id
    and occurrence.state='released'
    and lower(coalesce(occurrence.metadata->>'historical_release_provenance','false')) not in ('true','1','yes','on')
    and occurrence.planned_due_date is distinct from new.due_date;

  return new;
end;
$function$;

revoke all on function atlas.sync_active_task_due_date_occurrence_v1() from public,anon,authenticated;
grant execute on function atlas.sync_active_task_due_date_occurrence_v1() to service_role;

drop trigger if exists sync_active_task_due_date_occurrence_v1 on atlas.tasks;
create trigger sync_active_task_due_date_occurrence_v1
after update of due_date on atlas.tasks
for each row
when (new.due_date is not null and old.due_date is distinct from new.due_date)
execute function atlas.sync_active_task_due_date_occurrence_v1();

-- One pre-trigger split has decisive external operational evidence: the Elm
-- curbside pickup was explicitly moved to Aug. 13, while its released occurrence
-- still carried its original Aug. 7 date. Reconcile by stable farm/task identity,
-- never by generated UUID. Other ambiguous historical mismatches are untouched.
do $block$
declare
  v_task atlas.tasks%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
begin
  select task.* into v_task
  from atlas.tasks task
  join atlas.farms farm on farm.id=task.farm_id
  where farm.stable_key='elm_farm'
    and task.metadata->>'task_key'='anna_20260807_home_depot_curbside_pickup'
    and task.status in ('open','blocked');

  if v_task.id is null then
    return;
  end if;

  if v_task.due_date is distinct from date '2026-08-13' then
    raise exception 'Home Depot pickup canonical due date no longer matches the confirmed Aug. 13 move; refusing reconciliation.';
  end if;

  if coalesce(v_task.metadata->>'planned_occurrence_date_role','')='historical_release_provenance' then
    raise exception 'Home Depot pickup occurrence is now marked historical provenance; refusing reconciliation.';
  end if;

  select occurrence.* into v_occurrence
  from atlas.planned_work_occurrences occurrence
  where occurrence.id=coalesce(
      v_task.planned_occurrence_id,
      case
        when nullif(v_task.metadata->>'planned_occurrence_id','') ~* '^[0-9a-f-]{36}$'
        then (v_task.metadata->>'planned_occurrence_id')::uuid
        else null
      end
    )
    and occurrence.farm_id=v_task.farm_id
    and occurrence.released_task_id=v_task.id
    and occurrence.state='released';

  if v_occurrence.id is null then
    raise exception 'Home Depot pickup has no matching released occurrence; refusing reconciliation.';
  end if;

  if lower(coalesce(v_occurrence.metadata->>'historical_release_provenance','false')) in ('true','1','yes','on') then
    raise exception 'Home Depot pickup released occurrence is now historical provenance; refusing reconciliation.';
  end if;

  update atlas.planned_work_occurrences occurrence
  set planned_due_date=v_task.due_date,
      not_before_date=case
        when occurrence.not_before_date is null
          or occurrence.not_before_date=occurrence.planned_due_date
        then v_task.due_date
        else occurrence.not_before_date
      end,
      metadata=coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
        'confirmed_task_date_reconciliation',jsonb_build_object(
          'task_key','anna_20260807_home_depot_curbside_pickup',
          'from_date',occurrence.planned_due_date,
          'to_date',v_task.due_date,
          'source','explicit_owner_schedule_move',
          'reconciled_at',now()
        )
      ),
      updated_at=now()
  where occurrence.id=v_occurrence.id
    and occurrence.planned_due_date is distinct from v_task.due_date;
end;
$block$;
