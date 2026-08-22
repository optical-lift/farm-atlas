do $block$
declare
  v_task atlas.tasks%rowtype;
  v_transition_count integer;
begin
  select * into v_task
  from atlas.tasks
  where farm_id = (select id from atlas.farms where lower(name)='elm farm' limit 1)
    and metadata->>'task_key'='germination_thinning_365bfba7-e2d6-4a66-b7c8-6cd37f3ccbf1'
  limit 1;

  if v_task.id is null then
    raise exception 'Barn Bed 8 Horizon thinning task not found by stable task key.' using errcode='P0002';
  end if;

  select count(*) into v_transition_count
  from atlas.task_outcome_events event
  where event.task_id=v_task.id
    and event.outcome='not_relevant'
    and event.note='Deer reduced the ProCut Horizon stand in Barn Bed 8 enough that manual thinning is no longer needed.';

  if v_transition_count=0 then
    raise exception 'Expected deer-thinning not_relevant transition evidence is missing; refusing to infer it.' using errcode='P0001';
  end if;

  update atlas.tasks
  set status='archived',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'deer_thinning_reconciliation','confirmed_not_relevant',
        'deer_thinning_reconciliation_source','owner_report_2026-08-22',
        'deer_thinning_reconciliation_migration','reconcile_bb8_deer_thinned_thinning_task_v1'
      ),
      updated_at=now()
  where id=v_task.id
    and status<>'done';
end;
$block$;
