-- Fall kale canonical readiness reconciliation v1
--
-- The Day acceptance cue was seeded from an older transplant-readiness task.
-- Canonical crop-cycle truth now proves that the matching July 11 Grow Room kale
-- has already been potted up and is hardening off. Do not ask the worker to
-- re-observe a transition Atlas already knows happened, and do not manufacture a
-- second pot-up task. Preserve the old readiness task only as internal history.

do $$
declare
  v_task atlas.tasks%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_profile_id uuid;
  v_sown_date date;
  v_pot_up_date date;
begin
  select * into v_task
  from atlas.tasks task
  where task.status='open'
    and task.task_type='transplant_readiness'
    and task.metadata->>'crop_profile_stable_key'='fall_kale_seedling'
    and coalesce(task.metadata->>'variety','')='Fall kale mix'
    and coalesce(task.metadata->>'observation_delivery_mode','')='day_cue'
  order by task.created_at desc
  limit 1;

  if v_task.id is null then
    return;
  end if;

  begin
    v_profile_id:=nullif(v_task.metadata->>'crop_profile_id','')::uuid;
    v_sown_date:=nullif(v_task.metadata->>'source_sown_date','')::date;
  exception when invalid_text_representation then
    return;
  end;

  if v_profile_id is null or v_sown_date is null then
    return;
  end if;

  select cycle.* into v_cycle
  from atlas.crop_cycles cycle
  join atlas.growing_objects object on object.id=cycle.object_id
  where cycle.farm_id=v_task.farm_id
    and cycle.crop_profile_id=v_profile_id
    and cycle.sown_date=v_sown_date
    and cycle.lifecycle_status='active'
    and object.stable_key='grow_room_seed_shelves'
    and (
      cycle.cycle_state in ('hardening_off','potted_up','transplanted','established')
      or nullif(cycle.metadata->>'pot_up_date','') is not null
    )
  order by
    case when nullif(cycle.metadata->>'pot_up_date','') is not null then 0 else 1 end,
    cycle.updated_at desc,
    cycle.id
  limit 1;

  if v_cycle.id is null then
    -- Ambiguity is safer than a false reconciliation. Leave the cue alone when
    -- canonical crop truth does not prove the move already happened.
    return;
  end if;

  begin
    v_pot_up_date:=nullif(v_cycle.metadata->>'pot_up_date','')::date;
  exception when invalid_text_representation then
    v_pot_up_date:=null;
  end;

  insert into atlas.task_crop_cycles(
    id,task_id,crop_cycle_id,role,confidence,source,metadata
  ) values (
    gen_random_uuid(),
    v_task.id,
    v_cycle.id,
    'observes',
    'confirmed',
    'canonical_state_reconciliation_v1',
    jsonb_build_object(
      'reason','Matching crop profile + sow date + Grow Room crop state already proves pot-up occurred.',
      'reconciled_at',now()
    )
  )
  on conflict (task_id,crop_cycle_id,role) do update
  set confidence='confirmed',
      source='canonical_state_reconciliation_v1',
      metadata=coalesce(atlas.task_crop_cycles.metadata,'{}'::jsonb)
        || excluded.metadata;

  perform atlas.record_task_transition_v1_internal(
    p_task_id=>v_task.id,
    p_transition=>'done',
    p_idempotency_key=>'canonical-state-reconciliation:fall-kale:'||v_task.id::text,
    p_target_date=>null,
    p_note=>'Canonical crop state already shows this kale was potted up.',
    p_reason=>'The matching Grow Room crop cycle is already potted/hardening; no worker readiness check remains.',
    p_lane_key=>coalesce(v_task.action_key,'transplant_readiness'),
    p_work_key=>'transplant_readiness',
    p_payload=>jsonb_build_object(
      'completion_source','canonical_state_reconciliation',
      'readiness','already_potted',
      'crop_cycle_id',v_cycle.id,
      'crop_cycle_state',v_cycle.cycle_state,
      'pot_up_date',v_pot_up_date
    ),
    p_existing_field_log_id=>null
  );

  update atlas.tasks task
  set visibility_scope='system_internal',
      metadata=coalesce(task.metadata,'{}'::jsonb)
        || jsonb_build_object(
          'transplant_readiness_status','already_potted',
          'pot_up_reconciled_as_already_done',true,
          'canonical_crop_cycle_id',v_cycle.id,
          'canonical_state_reconciled_at',now(),
          'latest_transplant_readiness_observation',jsonb_strip_nulls(jsonb_build_object(
            'readiness','already_potted',
            'observed_date',v_pot_up_date,
            'recorded_at',now(),
            'source','canonical_state_reconciliation',
            'crop_cycle_id',v_cycle.id,
            'crop_cycle_state',v_cycle.cycle_state
          ))
        ),
      updated_at=now()
  where task.id=v_task.id;

  update atlas.worker_day_cues cue
  set response=jsonb_build_object(
        'readiness','already_potted',
        'source','canonical_state_reconciliation',
        'cropCycleId',v_cycle.id,
        'cropCycleState',v_cycle.cycle_state,
        'potUpDate',v_pot_up_date
      ),
      status='resolved',
      resolved_at=now(),
      updated_at=now()
  where cue.farm_id=v_task.farm_id
    and cue.membership_id=v_task.assigned_membership_id
    and cue.result_contract->>'kind'='transplant_readiness_gate_v1'
    and cue.result_contract->>'taskId'=v_task.id::text
    and cue.status not in ('resolved','dismissed');
end;
$$;
