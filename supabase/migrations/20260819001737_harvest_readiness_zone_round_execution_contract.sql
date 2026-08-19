create or replace function atlas.harvest_readiness_round_state_v1(
  p_parent_task_id uuid,
  p_as_of_date date default null::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_parent atlas.tasks%rowtype;
  v_round_date date;
  v_child_ids jsonb;
  v_total integer:=0;
  v_observed integer:=0;
  v_remaining jsonb:='[]'::jsonb;
  v_child_id_text text;
begin
  select * into v_parent from atlas.tasks where id=p_parent_task_id;
  if v_parent.id is null then raise exception 'Harvest readiness round was not found.' using errcode='P0002'; end if;
  if coalesce(v_parent.metadata->>'task_style','')<>'harvest_readiness_round' then
    raise exception 'Task is not a harvest readiness round.' using errcode='22023';
  end if;

  v_round_date:=coalesce(
    nullif(v_parent.metadata->>'round_date','')::date,
    v_parent.due_date,
    p_as_of_date,
    (now() at time zone 'America/Chicago')::date
  );
  v_child_ids:=coalesce(v_parent.metadata->'round_child_task_ids','[]'::jsonb);

  if jsonb_typeof(v_child_ids)<>'array' then v_child_ids:='[]'::jsonb; end if;

  for v_child_id_text in select jsonb_array_elements_text(v_child_ids)
  loop
    v_total:=v_total+1;
    if exists(
      select 1
      from atlas.crop_harvest_events e
      where e.task_id=v_child_id_text::uuid
        and e.event_kind='watch'
        and e.observed_date>=v_round_date
    ) then
      v_observed:=v_observed+1;
    else
      v_remaining:=v_remaining||jsonb_build_array(v_child_id_text);
    end if;
  end loop;

  return jsonb_build_object(
    'contractVersion','harvest_readiness_round_state_v1',
    'parentTaskId',v_parent.id,
    'roundDate',v_round_date,
    'childCount',v_total,
    'observedCount',v_observed,
    'remainingCount',greatest(v_total-v_observed,0),
    'remainingChildTaskIds',v_remaining,
    'state',case when v_total>0 and v_observed=v_total then 'complete' else 'observation_required' end,
    'complete',v_total>0 and v_observed=v_total,
    'truthBoundary',jsonb_build_object(
      'roundCompletionRequiresPhysicalObservationEvidence',true,
      'childTaskStatusAloneDoesNotProveObservation',true,
      'futureRecheckMayRemainOpenAfterRoundCompletion',true
    )
  );
end;
$function$;

create or replace function atlas.harvest_readiness_round_sync_v1(
  p_farm_id uuid,
  p_as_of_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_as_of date:=coalesce(p_as_of_date,current_date);
  v_group record;
  v_zone_label text;
  v_parent_id uuid;
  v_occurrence_id uuid;
  v_materialized jsonb;
  v_cohort_hash text;
  v_child_json jsonb;
  v_created integer:=0;
  v_reused integer:=0;
  v_grouped integer:=0;
  v_groups jsonb:='[]'::jsonb;
begin
  if p_farm_id is null then raise exception 'A farm is required.' using errcode='22023'; end if;

  for v_group in
    with child_zone as (
      select
        t.id task_id,
        t.assigned_membership_id,
        t.assigned_user_id,
        min(go.zone_id) zone_id,
        count(distinct go.zone_id)::integer zone_count
      from atlas.tasks t
      join atlas.task_crop_cycles tc on tc.task_id=t.id
      join atlas.crop_cycles cc on cc.id=tc.crop_cycle_id
      join atlas.growing_objects go on go.id=cc.object_id
      where t.farm_id=p_farm_id
        and t.status='open'
        and t.task_type='harvest_watch'
        and coalesce(t.metadata->>'harvest_watch_mode','')='boundary_observation'
        and t.due_date is not null
        and t.due_date<=v_as_of
        and t.visibility_scope='assigned_worker'
        and t.assigned_membership_id is not null
        and t.parent_task_id is null
      group by t.id,t.assigned_membership_id,t.assigned_user_id
      having count(distinct go.zone_id)=1
    )
    select
      cz.zone_id,
      cz.assigned_membership_id,
      min(cz.assigned_user_id::text)::uuid assigned_user_id,
      array_agg(cz.task_id order by cz.task_id) child_ids,
      count(*)::integer child_count
    from child_zone cz
    group by cz.zone_id,cz.assigned_membership_id
    order by cz.zone_id,cz.assigned_membership_id
  loop
    select z.label into v_zone_label from atlas.zones z where z.id=v_group.zone_id;
    if v_zone_label is null then continue; end if;

    select t.id into v_parent_id
    from atlas.tasks t
    where t.farm_id=p_farm_id
      and t.status in ('open','blocked')
      and t.assigned_membership_id=v_group.assigned_membership_id
      and t.zone_id=v_group.zone_id
      and t.due_date=v_as_of
      and coalesce(t.metadata->>'task_style','')='harvest_readiness_round'
    order by t.created_at,t.id
    limit 1;

    if v_parent_id is null then
      v_cohort_hash:=md5(array_to_string(v_group.child_ids,','));
      v_occurrence_id:=atlas.plan_work_occurrence_v1(
        p_farm_id=>p_farm_id,
        p_definition_key=>'harvest-readiness-round:'||v_group.zone_id::text,
        p_policy_key=>'harvest-readiness-round:'||v_group.zone_id::text||':one-active',
        p_occurrence_key=>'harvest-readiness-round:'||v_group.zone_id::text||':'||v_group.assigned_membership_id::text||':'||v_as_of::text||':'||v_cohort_hash,
        p_title=>'Harvest readiness round · '||v_zone_label,
        p_task_type=>'field_check',
        p_due_date=>v_as_of,
        p_source_kind=>'harvest_readiness_round',
        p_source_id=>v_group.zone_id,
        p_gate_type=>'time_window',
        p_horizon_days=>0,
        p_maximum_active_instances=>1,
        p_task_payload=>jsonb_build_object(
          'title','Harvest readiness round · '||v_zone_label,
          'task_type','field_check',
          'priority','high',
          'zone_id',v_group.zone_id,
          'note','Walk this zone once. Open each crop check inside the round and record what is physically true before moving on.',
          'action_key','harvest_readiness_round',
          'work_class','harvest',
          'visibility_scope','assigned_worker',
          'assigned_membership_id',v_group.assigned_membership_id,
          'assigned_user_id',v_group.assigned_user_id,
          'origin_kind','generated',
          'task_scope','farm_operation',
          'metadata',jsonb_build_object(
            'task_style','harvest_readiness_round',
            'estimated_minutes',30,
            'estimate_source','provisional:existing_field_check_rule',
            'round_date',v_as_of,
            'round_zone_id',v_group.zone_id,
            'round_zone_label',v_zone_label,
            'structured_child_results_required',true,
            'parent_done_requires_children_resolved',true,
            'physical_round_carrier_only',true,
            'children_hold_crop_truth',true,
            'work_window_key','anytime'
          )
        ),
        p_relation_payload=>'{}'::jsonb,
        p_gate_config=>jsonb_build_object('requiresDueHarvestObservationChildren',true),
        p_not_before_date=>v_as_of,
        p_metadata=>jsonb_build_object(
          'truthBoundary','harvest_readiness_zone_round_v1',
          'zoneId',v_group.zone_id,
          'zoneLabel',v_zone_label
        )
      );

      update atlas.planned_work_occurrences
      set work_lane='process_continuation',
          commitment_kind='dependency',
          effort_units=1,
          earliest_lawful_date=v_as_of,
          preferred_start_date=v_as_of,
          miss_consequence=jsonb_build_object(
            'class','biological_deadline',
            'detail','Harvest readiness remains physically unknown for unresolved crop observations in this zone until the round is performed and each crop result is recorded.'
          ),
          temporal_contract_source='harvest_readiness_zone_round_v1',
          temporal_contract_updated_at=now(),
          state='eligible',
          gate_satisfied_at=coalesce(gate_satisfied_at,now()),
          updated_at=now()
      where id=v_occurrence_id;

      v_materialized:=atlas.materialize_specific_work_occurrence_v1(v_occurrence_id,v_as_of);
      v_parent_id=nullif(v_materialized->>'taskId','')::uuid;
      if v_parent_id is null then
        v_groups:=v_groups||jsonb_build_array(jsonb_build_object(
          'zoneId',v_group.zone_id,'zoneLabel',v_zone_label,'state','parent_not_materialized','materialization',v_materialized,'childCount',v_group.child_count
        ));
        continue;
      end if;

      update atlas.tasks
      set operation_class='inspect_assess',
          operation_class_source='harvest_readiness_zone_round_v1',
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'operation_class','inspect_assess',
            'round_date',v_as_of,
            'round_zone_id',v_group.zone_id,
            'round_zone_label',v_zone_label
          )
      where id=v_parent_id;
      v_created:=v_created+1;
    else
      v_reused:=v_reused+1;
    end if;

    update atlas.tasks child
    set parent_task_id=v_parent_id,
        metadata=coalesce(child.metadata,'{}'::jsonb)||jsonb_build_object(
          'harvest_readiness_round_role','observation_child',
          'harvest_readiness_round_parent_id',v_parent_id,
          'harvest_readiness_round_date',v_as_of,
          'harvest_readiness_round_zone_id',v_group.zone_id,
          'harvest_readiness_round_zone',v_zone_label,
          'structured_harvest_result_required',true
        )
    where child.id=any(v_group.child_ids)
      and child.parent_task_id is null;
    get diagnostics v_grouped = row_count;

    select coalesce(jsonb_agg(x.task_id order by x.task_id),'[]'::jsonb)
    into v_child_json
    from (
      select distinct value::uuid task_id
      from jsonb_array_elements_text(coalesce((select metadata->'round_child_task_ids' from atlas.tasks where id=v_parent_id),'[]'::jsonb)) old_ids(value)
      union
      select unnest(v_group.child_ids)
    ) x;

    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'round_child_task_ids',v_child_json,
      'round_child_count',jsonb_array_length(v_child_json),
      'round_sync_at',now()
    )
    where id=v_parent_id;

    v_groups:=v_groups||jsonb_build_array(jsonb_build_object(
      'zoneId',v_group.zone_id,
      'zoneLabel',v_zone_label,
      'parentTaskId',v_parent_id,
      'state',case when v_created>0 then 'round_available' else 'round_reused' end,
      'candidateChildCount',v_group.child_count,
      'roundChildCount',jsonb_array_length(v_child_json)
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','harvest_readiness_round_sync_v1',
    'farmId',p_farm_id,
    'asOfDate',v_as_of,
    'createdRoundCount',v_created,
    'reusedRoundCount',v_reused,
    'groups',v_groups,
    'truthBoundary',jsonb_build_object(
      'onlyDuePhysicalObservationsAreGrouped',true,
      'futureRechecksRemainFutureObligationsUntilTheirDateArrives',true,
      'roundCarriesPhysicalVisitLabor',true,
      'childrenRetainCropSpecificObservationTruth',true,
      'zoneComesFromCanonicalGrowingObjectPlacement',true,
      'roundEstimateIsProvisionalNotActual',true
    )
  );
end;
$function$;

create or replace function atlas.advance_harvest_readiness_round_from_observation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_child atlas.tasks%rowtype;
  v_parent atlas.tasks%rowtype;
  v_state jsonb;
begin
  if new.event_kind<>'watch' or new.task_id is null then return new; end if;

  select * into v_child from atlas.tasks where id=new.task_id;
  if v_child.id is null or v_child.parent_task_id is null then return new; end if;

  select * into v_parent from atlas.tasks where id=v_child.parent_task_id;
  if v_parent.id is null or coalesce(v_parent.metadata->>'task_style','')<>'harvest_readiness_round' then return new; end if;

  -- The observation belongs historically to this round, but a recheck may need
  -- to remain alive after today's physical visit. Detach it before any parent
  -- completion can invoke the ordinary close-children trigger.
  update atlas.tasks
  set parent_task_id=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'harvest_readiness_round_observed_parent_id',v_parent.id,
        'harvest_readiness_round_observed_event_id',new.id,
        'harvest_readiness_round_observed_date',new.observed_date
      )
  where id=v_child.id and parent_task_id=v_parent.id;

  v_state:=atlas.harvest_readiness_round_state_v1(v_parent.id,new.observed_date);
  if coalesce((v_state->>'complete')::boolean,false)
     and v_parent.status in ('open','blocked') then
    perform atlas.record_task_transition_v1_internal(
      v_parent.id,
      'done',
      left('harvest-readiness-round:auto:'||v_parent.id::text||':'||new.observed_date::text,160),
      null,
      'All crop observations in this zone round were physically recorded.',
      null,
      'harvest',
      'harvest_readiness_round',
      jsonb_build_object(
        'completion_source','harvest_readiness_observation_evidence',
        'round_state',v_state,
        'last_observation_event_id',new.id
      ),
      null
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists crop_harvest_events_advance_readiness_round_v1 on atlas.crop_harvest_events;
create trigger crop_harvest_events_advance_readiness_round_v1
after insert on atlas.crop_harvest_events
for each row execute function atlas.advance_harvest_readiness_round_from_observation_v1();

create or replace function atlas.record_task_transition_v1_internal(
  p_task_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_target_date date default null::date,
  p_note text default null::text,
  p_reason text default null::text,
  p_lane_key text default null::text,
  p_work_key text default null::text,
  p_payload jsonb default '{}'::jsonb,
  p_existing_field_log_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_existing atlas.task_transitions%rowtype;
  v_children_closed integer:=0;
  v_round_state jsonb;
  v_round_date date;
begin
  if p_task_id is null then raise exception 'Task id is required.' using errcode='22023'; end if;
  select * into v_task from atlas.tasks t where t.id=p_task_id for update;
  if v_task.id is null then raise exception 'Task was not found.' using errcode='P0002'; end if;

  if p_transition in ('done','checklist_done') and v_task.status='done' then
    select * into v_existing from atlas.task_transitions tt where tt.task_id=v_task.id and tt.next_status='done' order by tt.created_at desc,tt.id desc limit 1;
    if coalesce(v_existing.payload->>'children_closed','') ~ '^\d+$' then v_children_closed:=(v_existing.payload->>'children_closed')::integer; end if;
    return jsonb_build_object('transitionId',v_existing.id,'taskId',v_task.id,'status','done','fieldLogId',v_existing.field_log_id,'taskOutcomeEventId',v_existing.task_outcome_event_id,'childTaskIds',coalesce(v_existing.payload->'child_task_ids','[]'::jsonb),'childrenClosed',v_children_closed,'nextTaskId',v_existing.payload->>'next_task_id','deduplicated',true,'terminalStateNoop',true);
  end if;

  if p_transition in ('done','checklist_done')
     and coalesce(v_task.metadata->>'task_style','')='harvest_readiness_round' then
    v_round_state:=atlas.harvest_readiness_round_state_v1(v_task.id,coalesce(v_task.due_date,current_date));
    if not coalesce((v_round_state->>'complete')::boolean,false) then
      raise exception 'Done rejected: record each crop harvest-readiness observation in this zone round first.' using errcode='P0001';
    end if;
  end if;

  if p_transition in ('done','checklist_done')
     and v_task.task_type='harvest_watch'
     and coalesce(v_task.metadata->>'harvest_watch_mode','')='boundary_observation'
     and coalesce(v_task.metadata->>'structured_harvest_result_required','false')='true' then
    v_round_date:=coalesce(nullif(v_task.metadata->>'harvest_readiness_round_date','')::date,v_task.due_date,current_date);
    if not exists(
      select 1 from atlas.crop_harvest_events e
      where e.task_id=v_task.id and e.event_kind='watch' and e.observed_date>=v_round_date
    ) then
      raise exception 'Done rejected: record the crop harvest-readiness result instead of checking this item off.' using errcode='P0001';
    end if;
  end if;

  if p_transition in ('done','checklist_done')
     and coalesce(v_task.metadata->>'seed_inventory_report_required','false')='true'
     and coalesce(v_task.metadata->>'seed_governance_required','false')='true'
     and not exists(
       select 1 from atlas.seed_inventory_events e
       where e.task_id=v_task.id and coalesce(e.metadata->>'operationEffect','')='direct_sow_seed_result'
     ) then
    raise exception 'Done rejected: this sowing operation requires its post-sow seed inventory result before completion.' using errcode='P0001';
  end if;

  return atlas.record_task_transition_v1_internal_legacy(
    p_task_id,p_transition,p_idempotency_key,p_target_date,p_note,p_reason,p_lane_key,p_work_key,coalesce(p_payload,'{}'::jsonb),p_existing_field_log_id
  );
end;
$function$;

create or replace function atlas.sync_due_harvest_readiness_observations_v1(
  p_farm_id uuid,
  p_as_of_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_cycle record;
  v_result jsonb;
  v_results jsonb:='[]'::jsonb;
  v_rounds jsonb;
  v_released integer:=0;
  v_kept integer:=0;
  v_observed integer:=0;
  v_other integer:=0;
begin
  if p_farm_id is null then raise exception 'A farm is required.' using errcode='22023'; end if;
  for v_cycle in
    select cc.id,cc.expected_harvest_watch_start
    from atlas.crop_cycles cc
    where cc.farm_id=p_farm_id
      and coalesce(cc.lifecycle_status,'active')='active'
      and atlas.crop_cycle_biological_progression_state_v1(cc.id,coalesce(p_as_of_date,current_date))->>'state'='harvest_readiness_inspection_required'
    order by cc.expected_harvest_watch_start,cc.id
  loop
    v_result:=atlas.ensure_due_harvest_readiness_observation_v1(v_cycle.id,coalesce(p_as_of_date,current_date),null);
    v_results:=v_results||jsonb_build_array(v_result);
    if v_result->>'state'='released' then v_released:=v_released+1;
    elsif v_result->>'state'='kept_current' then v_kept:=v_kept+1;
    elsif v_result->>'state'='boundary_already_observed' then v_observed:=v_observed+1;
    else v_other:=v_other+1;
    end if;
  end loop;

  v_rounds:=atlas.harvest_readiness_round_sync_v1(p_farm_id,coalesce(p_as_of_date,current_date));

  return jsonb_build_object(
    'contractVersion','sync_due_harvest_readiness_observations_v1',
    'farmId',p_farm_id,'asOfDate',coalesce(p_as_of_date,current_date),
    'releasedCount',v_released,'keptCurrentCount',v_kept,'alreadyObservedCount',v_observed,'otherCount',v_other,
    'results',v_results,
    'rounds',v_rounds,
    'truthBoundary',jsonb_build_object(
      'futureForecastRemainsTaskless',true,
      'onlyBoundaryCrossedInspectionStateIsMaterialized',true,
      'noPhysicalConditionIsInferred',true,
      'unrelatedEligibleWorkIsNotReleased',true,
      'dueObservationsAreGroupedIntoCanonicalZoneRounds',true,
      'cropSpecificObservationTruthRemainsAtomic',true
    )
  );
end;
$function$;