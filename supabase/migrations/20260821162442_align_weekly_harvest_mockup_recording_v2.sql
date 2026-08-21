-- Weekly Harvest follows the approved Harvest card specimen:
-- a positive half-bucket count is itself the harvest result; the only selectable
-- non-harvest outcomes are not ready, deadheaded, and crop exhausted.

do $$
begin
  if exists (select 1 from atlas.weekly_harvest_task_results limit 1) then
    raise exception 'Weekly Harvest v2 requires an empty v1 result ledger before changing result semantics.';
  end if;
end $$;

alter table atlas.weekly_harvest_task_results
  add column if not exists bucket_halves integer;

alter table atlas.weekly_harvest_task_results
  drop constraint if exists weekly_harvest_task_results_result_kind_check;

alter table atlas.weekly_harvest_task_results
  add constraint weekly_harvest_task_results_result_kind_check
  check (result_kind in ('harvest_amount','not_ready','deadheaded','crop_exhausted'));

alter table atlas.weekly_harvest_task_results
  drop constraint if exists weekly_harvest_task_results_v2_shape_check;

alter table atlas.weekly_harvest_task_results
  add constraint weekly_harvest_task_results_v2_shape_check
  check (
    (result_kind='harvest_amount' and bucket_halves is not null and bucket_halves>=1 and bucket_band is null and more_availability is null)
    or
    (result_kind in ('not_ready','deadheaded','crop_exhausted') and bucket_halves is null and bucket_band is null and more_availability is null)
  );

alter table atlas.flower_harvest_bucket_observations
  add column if not exists bucket_halves integer;

alter table atlas.flower_harvest_bucket_observations
  drop constraint if exists flower_harvest_bucket_observations_bucket_halves_check;

alter table atlas.flower_harvest_bucket_observations
  add constraint flower_harvest_bucket_observations_bucket_halves_check
  check (bucket_halves is null or bucket_halves>=1);

create or replace function atlas.weekly_harvest_task_state_core_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_rows jsonb:='[]'::jsonb;
  v_total integer:=0;
  v_resolved integer:=0;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Weekly Harvest task not found.' using errcode='P0002'; end if;
  if v_task.task_type<>'harvest' or v_task.task_series_key<>'anna_harvest_thursday_weekly' then
    raise exception 'Task is not the canonical weekly Harvest card.' using errcode='22023';
  end if;

  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_task.farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Harvest access denied.' using errcode='42501'; end if;
  if p_effective_role='farm_hand' and v_task.assigned_membership_id is distinct from p_effective_membership_id then
    raise exception 'Weekly Harvest is not assigned to this worker.' using errcode='42501';
  end if;

  with current_candidates as (
    select c.*,
      coalesce(nullif(z.label,''),'Elm Farm') as zone_label
    from atlas.weekly_harvest_candidate_cycles_v1(v_task.id) c
    join atlas.growing_objects go on go.id=c.object_id
    left join atlas.zones z on z.id=go.zone_id
  ), historical_results as (
    select
      cc.id crop_cycle_id,
      coalesce(nullif(cc.crop_label,''),'Crop') crop_label,
      nullif(cc.variety,'') variety,
      go.id object_id,
      coalesce(nullif(go.label,''),'Growing area') object_label,
      cc.expected_harvest_watch_start window_start,
      coalesce(cc.expected_harvest_watch_end,cc.expected_harvest_watch_start+21) window_end,
      coalesce(nullif(cc.cycle_state,''),'growing') cycle_state,
      cha.status availability_status,
      coalesce(nullif(z.label,''),'Elm Farm') zone_label
    from atlas.weekly_harvest_task_results wr
    join atlas.crop_cycles cc on cc.id=wr.crop_cycle_id
    join atlas.growing_objects go on go.id=cc.object_id
    left join atlas.zones z on z.id=go.zone_id
    left join atlas.crop_harvest_availability cha on cha.crop_cycle_id=cc.id
    where wr.task_id=v_task.id
  ), rows_union as (
    select * from current_candidates
    union
    select * from historical_results
  )
  select
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'cropCycleId',u.crop_cycle_id,
      'cropLabel',u.crop_label,
      'variety',u.variety,
      'zoneLabel',u.zone_label,
      'objectId',u.object_id,
      'objectLabel',u.object_label,
      'windowStart',u.window_start,
      'windowEnd',u.window_end,
      'cycleState',u.cycle_state,
      'availabilityStatus',u.availability_status,
      'resolved',wr.id is not null,
      'resultKind',wr.result_kind,
      'bucketHalves',wr.bucket_halves,
      'resolvedAt',wr.resolved_at
    )) order by u.zone_label,u.object_label,u.crop_label,u.variety,u.crop_cycle_id),'[]'::jsonb),
    count(*)::integer,
    count(wr.id)::integer
  into v_rows,v_total,v_resolved
  from rows_union u
  left join atlas.weekly_harvest_task_results wr on wr.task_id=v_task.id and wr.crop_cycle_id=u.crop_cycle_id;

  return jsonb_build_object(
    'contractVersion','weekly_harvest_round_v2',
    'taskId',v_task.id,
    'status',v_task.status,
    'dueDate',v_task.due_date,
    'rows',v_rows,
    'totalRows',v_total,
    'resolvedRows',v_resolved,
    'complete',v_total>0 and v_total=v_resolved,
    'operatorMode',p_operator_mode,
    'truthBoundary',jsonb_build_object(
      'oneWorkerFacingHarvestCard',true,
      'cropRowsAreNotTasks',true,
      'cropCycleTruthRemainsCanonical',true,
      'positiveBucketCountIsHarvestResult',true,
      'onlySelectableExceptions',jsonb_build_array('not_ready','deadheaded','crop_exhausted'),
      'bucketIncrement',0.5
    )
  );
end;
$$;

create or replace function atlas.record_weekly_harvest_row_core_v2(
  p_task_id uuid,
  p_crop_cycle_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_result_kind text,
  p_bucket_halves integer,
  p_idempotency_key text,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_existing atlas.weekly_harvest_task_results%rowtype;
  v_kind text:=lower(btrim(coalesce(p_result_kind,'')));
  v_halves integer:=p_bucket_halves;
  v_band text;
  v_floor numeric(5,2);
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_next_thursday date;
  v_event atlas.crop_harvest_events%rowtype;
  v_batch_id uuid;
  v_observation atlas.flower_harvest_bucket_observations%rowtype;
  v_result atlas.weekly_harvest_task_results%rowtype;
  v_unresolved integer:=0;
  v_transition jsonb;
  v_next jsonb;
  v_season_end date;
begin
  if v_kind not in ('harvest_amount','not_ready','deadheaded','crop_exhausted') then
    raise exception 'Choose a supported Harvest result.' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception 'Harvest idempotency key is required.' using errcode='22023';
  end if;
  if v_kind='harvest_amount' and coalesce(v_halves,0)<1 then
    raise exception 'Harvest amount must be at least one half bucket.' using errcode='22023';
  end if;
  if v_kind<>'harvest_amount' and v_halves is not null then
    raise exception 'Not ready, Deadheaded, and Crop exhausted do not take a harvest amount.' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Weekly Harvest task not found.' using errcode='P0002'; end if;
  if v_task.status not in ('open','blocked') or v_task.task_type<>'harvest' or v_task.task_series_key<>'anna_harvest_thursday_weekly' then
    raise exception 'Weekly Harvest card is not open.' using errcode='22023';
  end if;

  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_task.farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Harvest access denied.' using errcode='42501'; end if;
  if p_effective_role='farm_hand' and v_task.assigned_membership_id is distinct from p_effective_membership_id then
    raise exception 'Weekly Harvest is not assigned to this worker.' using errcode='42501';
  end if;

  select * into v_existing from atlas.weekly_harvest_task_results
  where farm_id=v_task.farm_id and idempotency_key=p_idempotency_key;
  if v_existing.id is null then
    select * into v_existing from atlas.weekly_harvest_task_results where task_id=v_task.id and crop_cycle_id=p_crop_cycle_id;
  end if;
  if v_existing.id is not null then
    return jsonb_build_object(
      'contractVersion','weekly_harvest_round_v2','deduplicated',true,
      'resultId',v_existing.id,'taskId',v_task.id,'cropCycleId',v_existing.crop_cycle_id,
      'resultKind',v_existing.result_kind,'bucketHalves',v_existing.bucket_halves
    );
  end if;

  select cc.* into v_cycle
  from atlas.weekly_harvest_candidate_cycles_v1(v_task.id) c
  join atlas.crop_cycles cc on cc.id=c.crop_cycle_id
  where c.crop_cycle_id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop is not on this weekly Harvest card.' using errcode='22023'; end if;

  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values(v_task.id,v_cycle.id,'harvests','confirmed','weekly_harvest_round_v2',jsonb_build_object('weeklyHarvestTaskId',v_task.id))
  on conflict(task_id,crop_cycle_id,role) do nothing;

  v_next_thursday:=v_today + case when ((4-extract(isodow from v_today)::integer+7)%7)=0 then 7 else ((4-extract(isodow from v_today)::integer+7)%7) end;

  if v_kind='harvest_amount' then
    v_band:=case when v_halves=1 then 'half' when v_halves=2 then 'one' else 'more_than_one' end;
    v_floor:=case when v_halves=1 then .50 else 1.00 end;

    insert into atlas.flower_harvest_batches(
      farm_id,harvest_date,recorded_by_membership_id,batch_key,metadata,created_by_user_id
    ) values (
      v_task.farm_id,v_today,p_effective_membership_id,'weekly-harvest:'||v_task.id::text,
      jsonb_build_object('physicalOutputMode','half_bucket_counter','precision','half_bucket','weeklyHarvestTaskId',v_task.id),auth.uid()
    )
    on conflict(farm_id,batch_key) do update set updated_at=now()
    returning id into v_batch_id;

    insert into atlas.flower_harvest_bucket_observations(
      farm_id,batch_id,crop_cycle_id,task_id,recorded_by_membership_id,observed_date,
      bucket_band,bucket_equivalent_floor,bucket_halves,more_available,note,idempotency_key,
      created_by_user_id,metadata,more_availability
    ) values (
      v_task.farm_id,v_batch_id,v_cycle.id,v_task.id,p_effective_membership_id,v_today,
      v_band,v_floor,v_halves,null,null,p_idempotency_key,auth.uid(),
      jsonb_build_object(
        'physicalOutputMode','half_bucket_counter','precision','half_bucket','weeklyHarvestTaskId',v_task.id,
        'bucketHalves',v_halves,'bucketQuantity',(v_halves::numeric/2),'operatorMode',p_operator_mode
      ),'unsure'
    ) returning * into v_observation;

    insert into atlas.crop_harvest_events(
      farm_id,crop_cycle_id,task_id,event_kind,outcome,observed_date,more_available,note,
      idempotency_key,created_by_user_id,metadata
    ) values (
      v_task.farm_id,v_cycle.id,v_task.id,'cut','harvested_amount',v_today,null,null,
      p_idempotency_key,auth.uid(),
      jsonb_build_object(
        'weeklyHarvestTaskId',v_task.id,'flowerHarvestBatchId',v_batch_id,
        'flowerHarvestObservationId',v_observation.id,'bucketHalves',v_halves,
        'bucketQuantity',(v_halves::numeric/2),'physicalOutputMode','half_bucket_counter'
      )
    ) returning * into v_event;

    update atlas.crop_cycles
    set harvest_started_date=coalesce(harvest_started_date,v_today),
        last_harvest_date=v_today,
        cycle_state='harvest_watch',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'last_harvest_event_id',v_event.id,
          'last_flower_harvest_observation_id',v_observation.id,
          'last_harvest_bucket_halves',v_halves,
          'physical_output_mode','half_bucket_counter'
        ),
        updated_at=now()
    where id=v_cycle.id;

    insert into atlas.crop_harvest_availability(
      crop_cycle_id,farm_id,status,observed_date,source_event_id,
      current_watch_task_id,current_watch_occurrence_id,current_harvest_task_id,current_harvest_occurrence_id,metadata
    ) values (
      v_cycle.id,v_task.farm_id,'watching',v_today,v_event.id,null,null,null,null,
      jsonb_build_object(
        'weeklyHarvestTaskId',v_task.id,'lastCutEventId',v_event.id,
        'bucketHalves',v_halves,'physicalOutputMode','half_bucket_counter'
      )
    )
    on conflict(crop_cycle_id) do update
    set status=excluded.status,observed_date=excluded.observed_date,source_event_id=excluded.source_event_id,
        current_watch_task_id=null,current_watch_occurrence_id=null,current_harvest_task_id=null,current_harvest_occurrence_id=null,
        metadata=atlas.crop_harvest_availability.metadata||excluded.metadata,updated_at=now();
  else
    insert into atlas.crop_harvest_events(
      farm_id,crop_cycle_id,task_id,event_kind,outcome,observed_date,next_check_date,note,
      idempotency_key,created_by_user_id,metadata
    ) values (
      v_task.farm_id,v_cycle.id,v_task.id,'watch',v_kind,v_today,
      case when v_kind in ('not_ready','deadheaded') then v_next_thursday else null end,
      null,p_idempotency_key,auth.uid(),
      jsonb_build_object('weeklyHarvestTaskId',v_task.id,'physicalObservationRecorded',true,'operatorMode',p_operator_mode)
    ) returning * into v_event;

    update atlas.crop_cycles
    set cycle_state=case when v_kind='crop_exhausted' then 'finished_harvest' else 'harvest_watch' end,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'last_harvest_watch_action',v_kind,'last_harvest_watch_date',v_today,'weekly_harvest_task_id',v_task.id
        ),
        updated_at=now()
    where id=v_cycle.id;

    insert into atlas.crop_harvest_availability(
      crop_cycle_id,farm_id,status,observed_date,source_event_id,
      current_watch_task_id,current_watch_occurrence_id,current_harvest_task_id,current_harvest_occurrence_id,metadata
    ) values (
      v_cycle.id,v_task.farm_id,case when v_kind='crop_exhausted' then 'finished' else 'watching' end,
      v_today,v_event.id,null,null,null,null,jsonb_build_object('weeklyHarvestTaskId',v_task.id,'lastAction',v_kind)
    )
    on conflict(crop_cycle_id) do update
    set status=excluded.status,observed_date=excluded.observed_date,source_event_id=excluded.source_event_id,
        current_watch_task_id=null,current_watch_occurrence_id=null,current_harvest_task_id=null,current_harvest_occurrence_id=null,
        metadata=atlas.crop_harvest_availability.metadata||excluded.metadata,updated_at=now();
  end if;

  insert into atlas.weekly_harvest_task_results(
    farm_id,task_id,crop_cycle_id,result_kind,bucket_halves,bucket_band,more_availability,note,
    crop_harvest_event_id,flower_harvest_observation_id,resolved_by_membership_id,idempotency_key,metadata
  ) values (
    v_task.farm_id,v_task.id,v_cycle.id,v_kind,case when v_kind='harvest_amount' then v_halves else null end,
    null,null,null,v_event.id,v_observation.id,p_effective_membership_id,p_idempotency_key,
    jsonb_build_object('operatorMode',p_operator_mode,'contractVersion','weekly_harvest_round_v2')
  ) returning * into v_result;

  perform atlas.reconcile_crop_cycle_requirement_state_v1(v_cycle.id);

  select count(*)::integer into v_unresolved
  from atlas.weekly_harvest_candidate_cycles_v1(v_task.id) c
  left join atlas.weekly_harvest_task_results r on r.task_id=v_task.id and r.crop_cycle_id=c.crop_cycle_id
  where r.id is null;

  if v_unresolved=0 and exists(select 1 from atlas.weekly_harvest_task_results where task_id=v_task.id) then
    v_transition:=atlas.record_task_transition_v1_internal(
      v_task.id,'done','weekly-harvest:auto:v2:'||v_task.id::text,null,
      'Every crop on this week''s Harvest card was physically resolved.',null,'harvest','weekly_harvest_round',
      jsonb_build_object('completion_source','weekly_harvest_crop_results_v2','last_result_id',v_result.id),null
    );
    begin v_season_end:=nullif(v_task.metadata->>'season_end','')::date; exception when others then v_season_end:=date '2026-11-12'; end;
    v_season_end:=coalesce(v_season_end,date '2026-11-12');
    if v_task.due_date is not null and v_task.due_date+7<=v_season_end then
      v_next:=atlas.ensure_weekly_harvest_card_v1(v_task.farm_id,v_task.due_date+7);
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','weekly_harvest_round_v2','deduplicated',false,
    'resultId',v_result.id,'taskId',v_task.id,'cropCycleId',v_cycle.id,
    'resultKind',v_kind,'bucketHalves',case when v_kind='harvest_amount' then v_halves else null end,
    'remainingRows',v_unresolved,'taskCompleted',v_transition is not null,'nextWeeklyCard',v_next
  );
end;
$$;

create or replace function atlas.record_weekly_harvest_row_for_member_v2(
  p_farm_id uuid,
  p_task_id uuid,
  p_crop_cycle_id uuid,
  p_result_kind text,
  p_bucket_halves integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  return atlas.record_weekly_harvest_row_core_v2(
    p_task_id,p_crop_cycle_id,v_membership,v_role,p_result_kind,p_bucket_halves,p_idempotency_key,false
  );
end;
$$;

create or replace function atlas.owner_operator_record_weekly_harvest_row_v2(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_crop_cycle_id uuid,
  p_result_kind text,
  p_bucket_halves integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_weekly_harvest_row_core_v2(
    p_task_id,p_crop_cycle_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',
    p_result_kind,p_bucket_halves,p_idempotency_key,true
  );
end;
$$;

revoke execute on function atlas.record_weekly_harvest_row_for_member_v1(uuid,uuid,uuid,text,text,text,text,text) from authenticated;
revoke execute on function atlas.owner_operator_record_weekly_harvest_row_v1(uuid,uuid,uuid,text,text,text,text,text) from authenticated;

grant execute on function atlas.record_weekly_harvest_row_for_member_v2(uuid,uuid,uuid,text,integer,text) to authenticated;
grant execute on function atlas.owner_operator_record_weekly_harvest_row_v2(uuid,uuid,uuid,text,integer,text) to authenticated;

create or replace function atlas.suppress_standalone_harvest_carrier_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
begin
  if new.task_series_key='anna_harvest_thursday_weekly' and new.task_type='harvest' then
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'task_style','weekly_harvest_round',
      'structured_result_required',true,
      'result_contract','weekly_harvest_round_v2',
      'crop_rows_derived_from_domain_truth',true,
      'standalone_harvest_tasks_forbidden',true,
      'half_bucket_counter',true,
      'selectable_outcomes',jsonb_build_array('not_ready','deadheaded','crop_exhausted')
    );
    return new;
  end if;

  if lower(coalesce(new.task_type,'')) in ('harvest_watch','crop_harvest','harvest_window')
     or (lower(coalesce(new.task_type,''))='field_check' and lower(coalesce(new.action_key,''))='harvest_readiness_round')
     or (lower(coalesce(new.task_type,''))='harvest' and lower(coalesce(new.action_key,''))='harvest') then
    new.status:='archived';
    new.task_type:='harvest_horizon_marker';
    new.action_key:='harvest_horizon';
    new.visibility_scope:='system_internal';
    new.assigned_membership_id:=null;
    new.assigned_user_id:=null;
    new.parent_task_id:=null;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'standaloneHarvestCarrierSuppressed',true,
      'suppressedBy','weekly_harvest_round_v2',
      'task_style','harvest_horizon_marker',
      'structured_result_required',false
    );
  end if;
  return new;
end;
$$;

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'result_contract','weekly_harvest_round_v2',
      'half_bucket_counter',true,
      'selectable_outcomes',jsonb_build_array('not_ready','deadheaded','crop_exhausted')
    ),
    updated_at=now()
where task_series_key='anna_harvest_thursday_weekly' and task_type='harvest';

update atlas.work_definitions
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'resultContract','weekly_harvest_round_v2',
      'halfBucketCounter',true,
      'selectableOutcomes',jsonb_build_array('not_ready','deadheaded','crop_exhausted')
    ),
    updated_at=now()
where stable_key='anna_harvest_thursday_weekly_2026';