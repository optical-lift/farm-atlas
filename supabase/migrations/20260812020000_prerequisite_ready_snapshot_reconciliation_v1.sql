-- The prerequisite engine preserves the state a task should return to after all
-- canonical prerequisites are satisfied. Several older dependency chains were
-- created while the downstream task was already blocked, so the first gate pass
-- captured `blocked` as the restore state. That makes a fully satisfied chain
-- restore to blocked forever.
--
-- Reconcile only rows where the source evidence is decisive. A separate external
-- gate remains a legitimate reason for a blocked restore and is not changed.

do $block$
declare
  v_task atlas.tasks%rowtype;
  v_prereq_count integer;
  v_external_gate_count integer;
  v_key text;
  v_expected_count integer;
  v_state jsonb;
begin
  for v_key,v_expected_count in
    select * from (values
      ('owner_price_cutter_local_products_application'::text,1::integer),
      ('owner_build_price_cutter_flower_test_offer'::text,1::integer),
      ('anna_20260817_transplant_fall_lettuce_entry_billboard'::text,2::integer),
      ('anna_20260817_transplant_fall_spinach_entry_billboard'::text,2::integer)
    ) expected(task_key,prerequisite_count)
  loop
    select task.* into v_task
    from atlas.tasks task
    where task.metadata->>'task_key'=v_key
    order by task.created_at desc
    limit 1;

    if v_task.id is null then
      raise exception 'Prerequisite ready-snapshot task % is missing; refusing reconciliation.',v_key;
    end if;

    if v_task.status not in ('open','blocked') then
      raise exception 'Prerequisite ready-snapshot task % is already terminal; refusing reconciliation.',v_key;
    end if;

    if coalesce(v_task.metadata->'prerequisite_gate_restore'->>'status','')<>'blocked' then
      raise exception 'Prerequisite ready-snapshot task % no longer has the expected blocked restore state; refusing reconciliation.',v_key;
    end if;

    select count(*)::integer,
           count(*) filter (where nullif(btrim(coalesce(prerequisite.metadata->>'external_gate','')),'') is not null)::integer
    into v_prereq_count,v_external_gate_count
    from atlas.task_prerequisites prerequisite
    where prerequisite.downstream_task_id=v_task.id
      and prerequisite.active;

    if v_prereq_count<>v_expected_count then
      raise exception 'Prerequisite ready-snapshot task % expected % active prerequisites, found %; refusing reconciliation.',v_key,v_expected_count,v_prereq_count;
    end if;

    if v_external_gate_count<>0 then
      raise exception 'Prerequisite ready-snapshot task % now has an external gate; refusing to make its restore state open.',v_key;
    end if;

    if v_key='anna_20260817_transplant_fall_lettuce_entry_billboard' then
      if not exists(
        select 1 from atlas.task_prerequisites prerequisite
        join atlas.tasks source on source.id=prerequisite.prerequisite_task_id
        where prerequisite.downstream_task_id=v_task.id and prerequisite.active
          and source.id::text in (
            nullif(v_task.metadata->>'reset_prerequisite_task_id',''),
            nullif(v_task.metadata->>'readiness_prerequisite_task_id','')
          )
        group by prerequisite.downstream_task_id
        having count(*)=2
      ) then
        raise exception 'Lettuce transplant prerequisite metadata no longer matches both canonical edges; refusing reconciliation.';
      end if;
    end if;

    if v_key='anna_20260817_transplant_fall_spinach_entry_billboard' then
      if not exists(
        select 1 from atlas.task_prerequisites prerequisite
        join atlas.tasks source on source.id=prerequisite.prerequisite_task_id
        where prerequisite.downstream_task_id=v_task.id and prerequisite.active
          and source.id::text in (
            nullif(v_task.metadata->>'reset_prerequisite_task_id',''),
            nullif(v_task.metadata->>'readiness_prerequisite_task_id','')
          )
        group by prerequisite.downstream_task_id
        having count(*)=2
      ) then
        raise exception 'Spinach transplant prerequisite metadata no longer matches both canonical edges; refusing reconciliation.';
      end if;
    end if;

    update atlas.tasks task
    set metadata=jsonb_set(
          jsonb_set(
            coalesce(task.metadata,'{}'::jsonb),
            '{prerequisite_gate_restore,status}',
            '"open"'::jsonb,
            false
          ),
          '{prerequisite_gate_restore,blocker_text}',
          'null'::jsonb,
          false
        ) || jsonb_build_object(
          'prerequisite_ready_snapshot_reconciled_at',now(),
          'prerequisite_ready_snapshot_source','canonical_dependency_audit_v1'
        ),
        updated_at=now()
    where task.id=v_task.id;

    v_state:=atlas.reconcile_task_prerequisite_gate_v1(v_task.id,now());

    if (v_state->>'state') not in ('blocked_visible','deferred_hidden','ready') then
      raise exception 'Prerequisite ready-snapshot task % reconciled to unexpected state %.',v_key,v_state;
    end if;
  end loop;

  -- This task has a real non-task external gate in addition to its task prerequisite.
  -- Its blocked restore is intentionally preserved.
  select task.* into v_task
  from atlas.tasks task
  where task.metadata->>'task_key'='anna_run_first_price_cutter_flower_test'
  order by task.created_at desc
  limit 1;

  if v_task.id is null then
    raise exception 'Price Cutter test execution task is missing; refusing external-gate guard check.';
  end if;

  if not exists(
    select 1
    from atlas.task_prerequisites prerequisite
    where prerequisite.downstream_task_id=v_task.id
      and prerequisite.active
      and nullif(btrim(coalesce(prerequisite.metadata->>'external_gate','')),'') is not null
  ) then
    raise exception 'Price Cutter test execution no longer carries its external approval gate; refusing migration.';
  end if;

  if coalesce(v_task.metadata->'prerequisite_gate_restore'->>'status','')<>'blocked' then
    raise exception 'Price Cutter test execution blocked restore changed unexpectedly; refusing migration.';
  end if;
end;
$block$;
