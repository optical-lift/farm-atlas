-- Harvest has one worker-facing carrier: Anna's weekly Thursday Harvest card.
-- Crop readiness and cut truth remain crop-cycle domain records, not child tasks.

create table if not exists atlas.weekly_harvest_task_results (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete cascade,
  result_kind text not null check (result_kind in ('not_ready','beginning','harvested','declining','finished','problem_or_uncertain')),
  bucket_band text check (bucket_band is null or bucket_band in ('quarter','half','three_quarters','one','more_than_one')),
  more_availability text check (more_availability is null or more_availability in ('yes','no','unsure')),
  note text,
  crop_harvest_event_id uuid references atlas.crop_harvest_events(id),
  flower_harvest_observation_id uuid references atlas.flower_harvest_bucket_observations(id),
  resolved_by_membership_id uuid not null references atlas.farm_memberships(id),
  idempotency_key text not null,
  resolved_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (task_id, crop_cycle_id),
  unique (farm_id, idempotency_key)
);

create index if not exists weekly_harvest_task_results_task_idx
  on atlas.weekly_harvest_task_results(task_id, resolved_at);
create index if not exists weekly_harvest_task_results_cycle_idx
  on atlas.weekly_harvest_task_results(crop_cycle_id, resolved_at desc);

alter table atlas.weekly_harvest_task_results enable row level security;

create or replace function atlas.weekly_harvest_candidate_cycles_v1(p_task_id uuid)
returns table (
  crop_cycle_id uuid,
  crop_label text,
  variety text,
  object_id uuid,
  object_label text,
  window_start date,
  window_end date,
  cycle_state text,
  availability_status text
)
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $$
  with ctx as (
    select t.id, t.farm_id, coalesce(t.due_date,(now() at time zone 'America/Chicago')::date) as service_date
    from atlas.tasks t
    where t.id=p_task_id
      and t.task_type='harvest'
      and t.task_series_key='anna_harvest_thursday_weekly'
  )
  select
    cc.id,
    coalesce(nullif(cc.crop_label,''),'Crop'),
    nullif(cc.variety,''),
    go.id,
    coalesce(nullif(go.label,''),'Growing area'),
    cc.expected_harvest_watch_start,
    coalesce(cc.expected_harvest_watch_end,cc.expected_harvest_watch_start+21),
    coalesce(nullif(cc.cycle_state,''),'growing'),
    cha.status
  from ctx
  join atlas.crop_cycles cc on cc.farm_id=ctx.farm_id
  join atlas.growing_objects go on go.id=cc.object_id
  left join atlas.crop_harvest_availability cha on cha.crop_cycle_id=cc.id
  where coalesce(cc.lifecycle_status,'active')='active'
    and cc.expected_harvest_watch_start is not null
    and coalesce(go.stable_key,'') not like 'grow_room_%'
    and lower(coalesce(cc.cycle_state,'')) not in ('failed','cleared','finished','finished_harvest')
    and coalesce(cha.status,'watching') <> 'finished'
    and (
      (
        cc.expected_harvest_watch_start <= ctx.service_date
        and coalesce(cc.expected_harvest_watch_end,cc.expected_harvest_watch_start+21) >= ctx.service_date
      )
      or cc.harvest_started_date is not null
      or exists (
        select 1 from atlas.crop_harvest_events e
        where e.crop_cycle_id=cc.id
          and e.event_kind='cut'
          and e.observed_date >= ctx.service_date-14
      )
    )
  order by go.label, cc.crop_label, cc.variety, cc.id;
$$;

create or replace function atlas.ensure_weekly_harvest_card_v1(p_farm_id uuid, p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_member atlas.farm_memberships%rowtype;
  v_existing atlas.tasks%rowtype;
  v_occurrence uuid;
  v_materialized jsonb;
  v_task_id uuid;
  v_season_end date:=date '2026-11-12';
begin
  if p_farm_id is null or p_due_date is null then
    raise exception 'Farm and Harvest service date are required.' using errcode='22023';
  end if;
  if extract(isodow from p_due_date)::integer<>4 then
    raise exception 'Weekly Harvest is a Thursday card.' using errcode='22023';
  end if;
  if p_due_date>v_season_end then
    return jsonb_build_object('state','outside_season','dueDate',p_due_date);
  end if;

  select * into v_member
  from atlas.farm_memberships
  where farm_id=p_farm_id and active and worker_key='anna'
  order by created_at limit 1;
  if v_member.id is null then
    return jsonb_build_object('state','anna_membership_missing','dueDate',p_due_date);
  end if;

  select * into v_existing
  from atlas.tasks
  where farm_id=p_farm_id
    and task_series_key='anna_harvest_thursday_weekly'
    and due_date=p_due_date
    and status<>'archived'
  order by created_at limit 1;

  if v_existing.id is not null then
    update atlas.tasks
    set title='Harvest',
        task_type='harvest',
        action_key='harvest',
        visibility_scope=case when status in ('open','blocked') then 'assigned_worker' else visibility_scope end,
        assigned_membership_id=case when status in ('open','blocked') then v_member.id else assigned_membership_id end,
        assigned_user_id=case when status in ('open','blocked') then v_member.user_id else assigned_user_id end,
        metadata=(coalesce(metadata,'{}'::jsonb)
          - 'visibility_suspended_at' - 'visibility_suspended_by' - 'visibility_suspend_reason' - 'visibility_scope_before_suspend')
          || jsonb_build_object(
            'task_style','weekly_harvest_round',
            'weekly_routine',true,
            'repeat_rule','weekly',
            'repeat_weekday','Thursday',
            'display_action','Harvest',
            'display_subject','Weekly harvest',
            'display_location','Elm Farm',
            'collection_zone','Elm Farm',
            'work_route','harvest',
            'structured_result_required',true,
            'result_contract','weekly_harvest_round_v1',
            'crop_rows_derived_from_domain_truth',true,
            'standalone_harvest_tasks_forbidden',true,
            'season_end',v_season_end::text
          ),
        updated_at=now()
    where id=v_existing.id;
    return jsonb_build_object('state','kept_current','taskId',v_existing.id,'occurrenceId',v_existing.planned_occurrence_id,'dueDate',p_due_date);
  end if;

  v_occurrence:=atlas.plan_fixed_assigned_worker_occurrence_v1(
    p_farm_id=>p_farm_id,
    p_membership_id=>v_member.id,
    p_user_id=>v_member.user_id,
    p_definition_key=>'anna_harvest_thursday_weekly_2026',
    p_policy_key=>'anna_harvest_thursday_weekly_2026:release',
    p_occurrence_key=>'recurring:anna_harvest_thursday_weekly:'||p_due_date::text,
    p_title=>'Harvest',
    p_task_type=>'harvest',
    p_due_date=>p_due_date,
    p_priority=>'high',
    p_action_key=>'harvest',
    p_series_key=>'anna_harvest_thursday_weekly',
    p_effort_units=>1,
    p_metadata=>jsonb_build_object(
      'task_style','weekly_harvest_round',
      'weekly_routine',true,
      'repeat_rule','weekly',
      'repeat_weekday','Thursday',
      'display_action','Harvest',
      'display_subject','Weekly harvest',
      'display_location','Elm Farm',
      'collection_zone','Elm Farm',
      'structured_result_required',true,
      'result_contract','weekly_harvest_round_v1',
      'crop_rows_derived_from_domain_truth',true,
      'standalone_harvest_tasks_forbidden',true,
      'season_end',v_season_end::text
    )
  );

  if p_due_date <= (now() at time zone 'America/Chicago')::date then
    v_materialized:=atlas.materialize_specific_work_occurrence_v1(v_occurrence,(now() at time zone 'America/Chicago')::date);
    begin v_task_id:=nullif(v_materialized->>'taskId','')::uuid; exception when others then v_task_id:=null; end;
  end if;

  return jsonb_build_object('state',case when v_task_id is null then 'planned' else 'released' end,'taskId',v_task_id,'occurrenceId',v_occurrence,'dueDate',p_due_date);
end;
$$;

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
    select * from atlas.weekly_harvest_candidate_cycles_v1(v_task.id)
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
      cha.status availability_status
    from atlas.weekly_harvest_task_results wr
    join atlas.crop_cycles cc on cc.id=wr.crop_cycle_id
    join atlas.growing_objects go on go.id=cc.object_id
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
      'objectId',u.object_id,
      'objectLabel',u.object_label,
      'windowStart',u.window_start,
      'windowEnd',u.window_end,
      'cycleState',u.cycle_state,
      'availabilityStatus',u.availability_status,
      'resolved',wr.id is not null,
      'resultKind',wr.result_kind,
      'bucketBand',wr.bucket_band,
      'moreAvailability',wr.more_availability,
      'note',wr.note,
      'resolvedAt',wr.resolved_at
    )) order by u.object_label,u.crop_label,u.variety,u.crop_cycle_id),'[]'::jsonb),
    count(*)::integer,
    count(wr.id)::integer
  into v_rows,v_total,v_resolved
  from rows_union u
  left join atlas.weekly_harvest_task_results wr on wr.task_id=v_task.id and wr.crop_cycle_id=u.crop_cycle_id;

  return jsonb_build_object(
    'contractVersion','weekly_harvest_round_v1',
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
      'bucketScaleRemainsCanonicalForFlowerOutput',true
    )
  );
end;
$$;

create or replace function atlas.weekly_harvest_task_state_for_member_v1(p_farm_id uuid,p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.weekly_harvest_task_state_core_v1(p_task_id,v_membership,v_role,false);
end;
$$;

create or replace function atlas.owner_operator_weekly_harvest_task_state_v1(p_effective_membership_id uuid,p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.weekly_harvest_task_state_core_v1(
    p_task_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',true
  );
end;
$$;

create or replace function atlas.record_weekly_harvest_row_core_v1(
  p_task_id uuid,
  p_crop_cycle_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_result_kind text,
  p_bucket_band text,
  p_more_availability text,
  p_note text,
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
  v_band text:=lower(btrim(coalesce(p_bucket_band,'')));
  v_more text:=lower(btrim(coalesce(p_more_availability,'')));
  v_more_bool boolean;
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
  if v_kind not in ('not_ready','beginning','harvested','declining','finished','problem_or_uncertain') then
    raise exception 'Choose a supported Harvest result.' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'Harvest idempotency key is required.' using errcode='22023'; end if;
  if v_kind='harvested' then
    if v_band not in ('quarter','half','three_quarters','one','more_than_one') then raise exception 'Choose the closest bucket amount.' using errcode='22023'; end if;
    if v_more not in ('yes','no','unsure') then raise exception 'Record whether more remains: yes, no, or unsure.' using errcode='22023'; end if;
  end if;
  if v_kind='problem_or_uncertain' and nullif(btrim(coalesce(p_note,'')),'') is null then
    raise exception 'Describe what is uncertain.' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Weekly Harvest task not found.' using errcode='P0002'; end if;
  if v_task.status not in ('open','blocked') or v_task.task_type<>'harvest' or v_task.task_series_key<>'anna_harvest_thursday_weekly' then
    raise exception 'Weekly Harvest card is not open.' using errcode='22023';
  end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_task.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Harvest access denied.' using errcode='42501'; end if;
  if p_effective_role='farm_hand' and v_task.assigned_membership_id is distinct from p_effective_membership_id then raise exception 'Weekly Harvest is not assigned to this worker.' using errcode='42501'; end if;

  select * into v_existing from atlas.weekly_harvest_task_results
  where farm_id=v_task.farm_id and idempotency_key=p_idempotency_key;
  if v_existing.id is null then
    select * into v_existing from atlas.weekly_harvest_task_results where task_id=v_task.id and crop_cycle_id=p_crop_cycle_id;
  end if;
  if v_existing.id is not null then
    return jsonb_build_object('contractVersion','weekly_harvest_round_v1','deduplicated',true,'resultId',v_existing.id,'taskId',v_task.id,'cropCycleId',v_existing.crop_cycle_id,'resultKind',v_existing.result_kind);
  end if;

  select cc.* into v_cycle
  from atlas.weekly_harvest_candidate_cycles_v1(v_task.id) c
  join atlas.crop_cycles cc on cc.id=c.crop_cycle_id
  where c.crop_cycle_id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop is not on this weekly Harvest card.' using errcode='22023'; end if;

  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values(v_task.id,v_cycle.id,'harvests','confirmed','weekly_harvest_round_v1',jsonb_build_object('weeklyHarvestTaskId',v_task.id))
  on conflict(task_id,crop_cycle_id,role) do nothing;

  v_next_thursday:=v_today + case when ((4-extract(isodow from v_today)::integer+7)%7)=0 then 7 else ((4-extract(isodow from v_today)::integer+7)%7) end;

  if v_kind='harvested' then
    v_floor:=case v_band when 'quarter' then .25 when 'half' then .50 when 'three_quarters' then .75 else 1.00 end;
    v_more_bool:=case when v_more='yes' then true when v_more='no' then false else null end;

    insert into atlas.flower_harvest_batches(farm_id,harvest_date,recorded_by_membership_id,batch_key,metadata,created_by_user_id)
    values(v_task.farm_id,v_today,p_effective_membership_id,'weekly-harvest:'||v_task.id::text,
      jsonb_build_object('physicalOutputMode','bucket_scale','precision','coarse_physical','weeklyHarvestTaskId',v_task.id),auth.uid())
    on conflict(farm_id,batch_key) do update set updated_at=now()
    returning id into v_batch_id;

    insert into atlas.flower_harvest_bucket_observations(
      farm_id,batch_id,crop_cycle_id,task_id,recorded_by_membership_id,observed_date,bucket_band,bucket_equivalent_floor,
      more_available,note,idempotency_key,created_by_user_id,metadata,more_availability
    ) values (
      v_task.farm_id,v_batch_id,v_cycle.id,v_task.id,p_effective_membership_id,v_today,v_band,v_floor,
      v_more_bool,nullif(btrim(coalesce(p_note,'')),''),p_idempotency_key,auth.uid(),
      jsonb_build_object('physicalOutputMode','bucket_scale','precision','coarse_physical','weeklyHarvestTaskId',v_task.id,'operatorMode',p_operator_mode),v_more
    ) returning * into v_observation;

    insert into atlas.crop_harvest_events(
      farm_id,crop_cycle_id,task_id,event_kind,outcome,observed_date,more_available,note,idempotency_key,created_by_user_id,metadata
    ) values (
      v_task.farm_id,v_cycle.id,v_task.id,'cut',
      case when v_more='yes' then 'harvested_more' when v_more='no' then 'harvested_finished' else 'harvested_uncertain' end,
      v_today,v_more_bool,nullif(btrim(coalesce(p_note,'')),''),p_idempotency_key,auth.uid(),
      jsonb_build_object('weeklyHarvestTaskId',v_task.id,'flowerHarvestBatchId',v_batch_id,'flowerHarvestObservationId',v_observation.id,'bucketBand',v_band,'bucketEquivalentFloor',v_floor,'moreAvailability',v_more)
    ) returning * into v_event;

    update atlas.crop_cycles
    set harvest_started_date=coalesce(harvest_started_date,v_today),last_harvest_date=v_today,
        cycle_state=case when v_more='no' then 'finished_harvest' else 'harvest_watch' end,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_harvest_event_id',v_event.id,'last_flower_harvest_observation_id',v_observation.id,'physical_output_mode','bucket_scale','more_availability',v_more),updated_at=now()
    where id=v_cycle.id;

    insert into atlas.crop_harvest_availability(crop_cycle_id,farm_id,status,observed_date,source_event_id,current_watch_task_id,current_watch_occurrence_id,current_harvest_task_id,current_harvest_occurrence_id,metadata)
    values(v_cycle.id,v_task.farm_id,case when v_more='no' then 'finished' when v_more='unsure' then 'uncertain' else 'watching' end,v_today,v_event.id,null,null,null,null,
      jsonb_build_object('weeklyHarvestTaskId',v_task.id,'lastCutEventId',v_event.id,'moreAvailability',v_more,'physicalOutputMode','bucket_scale'))
    on conflict(crop_cycle_id) do update set status=excluded.status,observed_date=excluded.observed_date,source_event_id=excluded.source_event_id,
      current_watch_task_id=null,current_watch_occurrence_id=null,current_harvest_task_id=null,current_harvest_occurrence_id=null,
      metadata=atlas.crop_harvest_availability.metadata||excluded.metadata,updated_at=now();
  else
    insert into atlas.crop_harvest_events(
      farm_id,crop_cycle_id,task_id,event_kind,outcome,observed_date,next_check_date,note,idempotency_key,created_by_user_id,metadata
    ) values (
      v_task.farm_id,v_cycle.id,v_task.id,'watch',v_kind,v_today,
      case when v_kind in ('not_ready','beginning','declining') then v_next_thursday else null end,
      nullif(btrim(coalesce(p_note,'')),''),p_idempotency_key,auth.uid(),
      jsonb_build_object('weeklyHarvestTaskId',v_task.id,'physicalObservationRecorded',true,'operatorMode',p_operator_mode)
    ) returning * into v_event;

    update atlas.crop_cycles
    set cycle_state=case when v_kind='finished' then 'finished_harvest' when v_kind='declining' then 'declining' else cycle_state end,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_harvest_watch_action',v_kind,'last_harvest_watch_date',v_today,'weekly_harvest_task_id',v_task.id),updated_at=now()
    where id=v_cycle.id;

    insert into atlas.crop_harvest_availability(crop_cycle_id,farm_id,status,observed_date,source_event_id,current_watch_task_id,current_watch_occurrence_id,current_harvest_task_id,current_harvest_occurrence_id,metadata)
    values(v_cycle.id,v_task.farm_id,
      case when v_kind='finished' then 'finished' when v_kind='declining' then 'declining' when v_kind='problem_or_uncertain' then 'uncertain' else 'watching' end,
      v_today,v_event.id,null,null,null,null,jsonb_build_object('weeklyHarvestTaskId',v_task.id,'lastAction',v_kind))
    on conflict(crop_cycle_id) do update set status=excluded.status,observed_date=excluded.observed_date,source_event_id=excluded.source_event_id,
      current_watch_task_id=null,current_watch_occurrence_id=null,current_harvest_task_id=null,current_harvest_occurrence_id=null,
      metadata=atlas.crop_harvest_availability.metadata||excluded.metadata,updated_at=now();
  end if;

  insert into atlas.weekly_harvest_task_results(
    farm_id,task_id,crop_cycle_id,result_kind,bucket_band,more_availability,note,crop_harvest_event_id,flower_harvest_observation_id,
    resolved_by_membership_id,idempotency_key,metadata
  ) values (
    v_task.farm_id,v_task.id,v_cycle.id,v_kind,case when v_kind='harvested' then v_band else null end,
    case when v_kind='harvested' then v_more else null end,nullif(btrim(coalesce(p_note,'')),''),v_event.id,v_observation.id,
    p_effective_membership_id,p_idempotency_key,jsonb_build_object('operatorMode',p_operator_mode)
  ) returning * into v_result;

  perform atlas.reconcile_crop_cycle_requirement_state_v1(v_cycle.id);

  select count(*)::integer into v_unresolved
  from atlas.weekly_harvest_candidate_cycles_v1(v_task.id) c
  left join atlas.weekly_harvest_task_results r on r.task_id=v_task.id and r.crop_cycle_id=c.crop_cycle_id
  where r.id is null;

  if v_unresolved=0 and exists(select 1 from atlas.weekly_harvest_task_results where task_id=v_task.id) then
    v_transition:=atlas.record_task_transition_v1_internal(
      v_task.id,'done','weekly-harvest:auto:'||v_task.id::text,null,
      'Every crop on this week''s Harvest card was physically resolved.',null,'harvest','weekly_harvest_round',
      jsonb_build_object('completion_source','weekly_harvest_crop_results','last_result_id',v_result.id),null
    );
    begin v_season_end:=nullif(v_task.metadata->>'season_end','')::date; exception when others then v_season_end:=date '2026-11-12'; end;
    v_season_end:=coalesce(v_season_end,date '2026-11-12');
    if v_task.due_date is not null and v_task.due_date+7<=v_season_end then
      v_next:=atlas.ensure_weekly_harvest_card_v1(v_task.farm_id,v_task.due_date+7);
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','weekly_harvest_round_v1','deduplicated',false,'resultId',v_result.id,'taskId',v_task.id,
    'cropCycleId',v_cycle.id,'resultKind',v_kind,'bucketBand',case when v_kind='harvested' then v_band else null end,
    'moreAvailability',case when v_kind='harvested' then v_more else null end,'remainingRows',v_unresolved,
    'taskCompleted',v_transition is not null,'nextWeeklyCard',v_next
  );
end;
$$;

create or replace function atlas.record_weekly_harvest_row_for_member_v1(
  p_farm_id uuid,p_task_id uuid,p_crop_cycle_id uuid,p_result_kind text,p_bucket_band text,p_more_availability text,p_note text,p_idempotency_key text
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
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_weekly_harvest_row_core_v1(p_task_id,p_crop_cycle_id,v_membership,v_role,p_result_kind,p_bucket_band,p_more_availability,p_note,p_idempotency_key,false);
end;
$$;

create or replace function atlas.owner_operator_record_weekly_harvest_row_v1(
  p_effective_membership_id uuid,p_task_id uuid,p_crop_cycle_id uuid,p_result_kind text,p_bucket_band text,p_more_availability text,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_weekly_harvest_row_core_v1(
    p_task_id,p_crop_cycle_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',
    p_result_kind,p_bucket_band,p_more_availability,p_note,p_idempotency_key,true
  );
end;
$$;

-- Forecast/boundary systems no longer materialize Harvest worker tasks.
create or replace function atlas.ensure_due_harvest_readiness_observation_v1(p_crop_cycle_id uuid,p_as_of_date date default current_date,p_assigned_membership_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare v_cycle atlas.crop_cycles%rowtype;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;
  return jsonb_build_object(
    'contractVersion','weekly_harvest_round_v1','state','carried_by_weekly_harvest_card','cropCycleId',v_cycle.id,
    'boundaryDate',v_cycle.expected_harvest_watch_start,'asOfDate',coalesce(p_as_of_date,current_date),
    'truthBoundary',jsonb_build_object('noStandaloneHarvestReadinessTask',true,'physicalObservationStillRequired',true)
  );
end;
$$;

create or replace function atlas.harvest_readiness_round_sync_v1(p_farm_id uuid,p_as_of_date date default current_date)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','atlas'
as $$
  select jsonb_build_object(
    'contractVersion','weekly_harvest_round_v1','farmId',p_farm_id,'asOfDate',coalesce(p_as_of_date,current_date),
    'createdRoundCount',0,'reusedRoundCount',0,'groups','[]'::jsonb,
    'truthBoundary',jsonb_build_object('zoneHarvestRoundsRetired',true,'weeklyHarvestCardIsOnlyWorkerCarrier',true)
  );
$$;

create or replace function atlas.ensure_crop_harvest_task_v1(p_crop_cycle_id uuid,p_source_event_id uuid,p_due_date date,p_assigned_membership_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare v_cycle atlas.crop_cycles%rowtype; v_due date; v_card jsonb;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;
  v_due:=coalesce(p_due_date,(now() at time zone 'America/Chicago')::date);
  v_due:=v_due + case when ((4-extract(isodow from v_due)::integer+7)%7)=0 then 0 else ((4-extract(isodow from v_due)::integer+7)%7) end;
  v_card:=atlas.ensure_weekly_harvest_card_v1(v_cycle.farm_id,v_due);
  update atlas.crop_harvest_availability
  set current_harvest_task_id=null,current_harvest_occurrence_id=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('executionCarrier','weekly_harvest_round_v1'),updated_at=now()
  where crop_cycle_id=v_cycle.id;
  return jsonb_build_object('contractVersion','weekly_harvest_round_v1','state','carried_by_weekly_harvest_card','cropCycleId',v_cycle.id,'weeklyCard',v_card);
end;
$$;

create or replace function atlas.ensure_crop_harvest_requirement_execution_v1(p_requirement_instance_id uuid,p_as_of_date date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare v_req atlas.state_consequence_instances%rowtype; v_cycle atlas.crop_cycles%rowtype; v_day date; v_card jsonb;
begin
  select * into v_req from atlas.state_consequence_instances where id=p_requirement_instance_id;
  if v_req.id is null then raise exception 'Requirement instance not found.' using errcode='P0002'; end if;
  if v_req.status<>'open' or v_req.subject_kind<>'crop_cycle' or v_req.action_key<>'harvest' then
    return jsonb_build_object('contractVersion','weekly_harvest_round_v1','state','not_open_harvest_requirement','requirementInstanceId',v_req.id);
  end if;
  select * into v_cycle from atlas.crop_cycles where id=v_req.subject_id;
  v_day:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_day:=v_day + case when ((4-extract(isodow from v_day)::integer+7)%7)=0 then 0 else ((4-extract(isodow from v_day)::integer+7)%7) end;
  v_card:=atlas.ensure_weekly_harvest_card_v1(v_req.farm_id,v_day);
  update atlas.crop_harvest_availability
  set current_harvest_task_id=null,current_harvest_occurrence_id=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('executionCarrier','weekly_harvest_round_v1','sourceRequirementInstanceId',v_req.id),updated_at=now()
  where crop_cycle_id=v_cycle.id;
  return jsonb_build_object('contractVersion','weekly_harvest_round_v1','state','carried_by_weekly_harvest_card','requirementInstanceId',v_req.id,'cropCycleId',v_cycle.id,'weeklyCard',v_card);
end;
$$;

create or replace function atlas.suppress_standalone_harvest_carrier_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
begin
  if new.task_series_key='anna_harvest_thursday_weekly' and new.task_type='harvest' then return new; end if;
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
      'standaloneHarvestCarrierSuppressed',true,'suppressedBy','weekly_harvest_round_v1','task_style','harvest_horizon_marker','structured_result_required',false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists zzzz_tasks_suppress_standalone_harvest_carrier_v1 on atlas.tasks;
create trigger zzzz_tasks_suppress_standalone_harvest_carrier_v1
before insert or update of task_type,action_key,task_series_key,status on atlas.tasks
for each row execute function atlas.suppress_standalone_harvest_carrier_v1();

-- Retire every currently open alternate Harvest carrier, including orphan/manual Harvest work.
update atlas.tasks
set status='archived',
    visibility_scope='system_internal',
    assigned_membership_id=null,
    assigned_user_id=null,
    parent_task_id=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'retiredBy','weekly_harvest_round_v1','retiredAt',now(),'retiredReason','Harvest is represented only by Anna''s weekly Thursday card.'
    ),
    updated_at=now()
where status in ('open','blocked')
  and not (task_type='harvest' and task_series_key='anna_harvest_thursday_weekly')
  and (
    task_type in ('harvest','harvest_watch','crop_harvest','harvest_window')
    or action_key in ('harvest','harvest_watch','harvest_readiness_round')
    or coalesce(metadata->>'task_style','') in ('harvest_watch','harvest_readiness_round','harvest_window','requirement_execution_harvest')
  );

update atlas.planned_work_occurrences pwo
set state='cancelled',updated_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancelledBy','weekly_harvest_round_v1')
where state in ('planned','eligible','releasing','released','failed')
  and released_task_id in (
    select id from atlas.tasks where status='archived' and coalesce(metadata->>'retiredBy','')='weekly_harvest_round_v1'
  );

update atlas.crop_harvest_availability
set current_watch_task_id=null,current_watch_occurrence_id=null,current_harvest_task_id=null,current_harvest_occurrence_id=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('executionCarrier','weekly_harvest_round_v1'),updated_at=now();

update atlas.work_definitions
set title_template='Harvest',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('taskStyle','weekly_harvest_round','oneWorkerFacingHarvestCard',true),
    updated_at=now()
where stable_key='anna_harvest_thursday_weekly_2026';

-- Restore and normalize the current weekly card that was temporarily hidden during the harvest audit.
with farm as (select id from atlas.farms where stable_key='elm_farm')
select atlas.ensure_weekly_harvest_card_v1(farm.id,date '2026-08-20') from farm;

grant execute on function atlas.weekly_harvest_task_state_for_member_v1(uuid,uuid) to authenticated;
grant execute on function atlas.owner_operator_weekly_harvest_task_state_v1(uuid,uuid) to authenticated;
grant execute on function atlas.record_weekly_harvest_row_for_member_v1(uuid,uuid,uuid,text,text,text,text,text) to authenticated;
grant execute on function atlas.owner_operator_record_weekly_harvest_row_v1(uuid,uuid,uuid,text,text,text,text,text) to authenticated;
