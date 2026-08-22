do $migration$
declare
  v_task atlas.tasks%rowtype;
  v_anna atlas.farm_memberships%rowtype;
  v_result jsonb;
  v_transition_id uuid;
  v_outcome_id uuid;
  v_event_key text;
  v_actual_date date := date '2026-08-21';
begin
  select * into v_task
  from atlas.tasks
  where metadata->>'task_key'='anna_20260817_sow_procut_orange_fr11_fr12_after_turnover'
  order by created_at
  limit 1;

  if v_task.id is null then
    raise exception 'Canonical FR11/FR12 ProCut Orange sow task was not found.';
  end if;

  select * into v_anna
  from atlas.farm_memberships
  where farm_id=v_task.farm_id and worker_key='anna' and active
  order by created_at
  limit 1;

  if v_anna.id is null then
    raise exception 'Active Anna farm membership was not found.';
  end if;

  if not exists (
    select 1
    from atlas.seed_lot_task_links link
    join atlas.seed_lots lot on lot.id=link.seed_lot_id
    where link.task_id=v_task.id
      and link.link_role='sowing_input'
      and lot.stable_key='procut_orange_second_bag_existing_inventory_2026'
  ) then
    raise exception 'FR11/FR12 sow task is not linked to the canonical ProCut Orange second-bag seed lot.';
  end if;

  if (select count(*) from atlas.crop_cycles cc join atlas.growing_objects go on go.id=cc.object_id
      where cc.source_task_id=v_task.id and go.stable_key in ('fr_11','fr_12')) <> 2 then
    raise exception 'Expected exactly two canonical FR11/FR12 crop cycles for the sow task.';
  end if;

  v_event_key := 'direct-sow-result:'||v_task.id::text||':2026-08-21:historical-reconciliation';

  if not exists (
    select 1 from atlas.seed_inventory_events
    where farm_id=v_task.farm_id and event_key=v_event_key
  ) then
    if v_task.status not in ('open','blocked') then
      raise exception 'FR11/FR12 sow task is %, but the historical depleted seed event is absent.',v_task.status;
    end if;

    v_result := atlas.record_direct_sow_seed_effect_v1(
      v_task.id,
      v_anna.id,
      'depleted',
      null,
      'Anna reported Aug. 22 that she used the last of all pollenless seeds while sowing Field Rows 11 and 12 on Aug. 21; this reconciles the result Atlas rejected on Aug. 21.',
      v_event_key
    );

    v_transition_id := nullif(v_result #>> '{transition,transitionId}','')::uuid;
    v_outcome_id := nullif(v_result #>> '{transition,taskOutcomeEventId}','')::uuid;
  end if;

  update atlas.seed_inventory_state state
  set metadata=coalesce(state.metadata,'{}'::jsonb)||jsonb_build_object(
        'physicalEffectiveDate',v_actual_date,
        'physicalEffectiveDatePrecision','date_only',
        'reportedOn',date '2026-08-22',
        'reportSource','worker_report_after_rejected_save'
      ),
      updated_at=now()
  from atlas.seed_lots lot
  where state.seed_lot_id=lot.id
    and lot.farm_id=v_task.farm_id
    and lot.stable_key='procut_orange_second_bag_existing_inventory_2026';

  update atlas.tasks
  set due_date=v_actual_date,
      completed_at=make_timestamptz(2026,8,21,12,0,0,'America/Chicago'),
      completed_by='Anna',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'completed_on',v_actual_date,
        'completion_time_precision','date_only',
        'result_reconciled_on',date '2026-08-22',
        'result_reconciliation_source','worker_report_after_rejected_save',
        'rejected_save_originally_attempted_on',v_actual_date
      )
  where id=v_task.id;

  update atlas.crop_cycles cc
  set sown_date=v_actual_date,
      metadata=coalesce(cc.metadata,'{}'::jsonb)||jsonb_build_object(
        'sown_date_source','worker_report_after_rejected_save',
        'sown_date_reconciled_on',date '2026-08-22',
        'sown_time_precision','date_only'
      )
  from atlas.growing_objects go
  where cc.source_task_id=v_task.id
    and go.id=cc.object_id
    and go.stable_key in ('fr_11','fr_12');

  update atlas.tasks followup
  set metadata=coalesce(followup.metadata,'{}'::jsonb)||jsonb_build_object(
        'source_sown_date',v_actual_date,
        'source_sown_date_precision','date_only',
        'source_sown_date_reconciled_on',date '2026-08-22',
        'timing_authority','canonical_germination_rhythm'
      )
  where followup.task_type='germination_check'
    and (
      followup.generated_from_id=v_task.id
      or followup.metadata->>'source_sowing_task_id'=v_task.id::text
    );

  if v_transition_id is not null then
    update atlas.task_transitions
    set payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
      'physical_effective_date',v_actual_date,
      'physical_effective_date_precision','date_only',
      'result_reconciled_on',date '2026-08-22',
      'result_reconciliation_source','worker_report_after_rejected_save'
    )
    where id=v_transition_id;
  end if;

  if v_outcome_id is not null then
    update atlas.task_outcome_events
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'physical_effective_date',v_actual_date,
      'physical_effective_date_precision','date_only',
      'result_reconciled_on',date '2026-08-22',
      'result_reconciliation_source','worker_report_after_rejected_save'
    )
    where id=v_outcome_id;
  end if;
end
$migration$;
