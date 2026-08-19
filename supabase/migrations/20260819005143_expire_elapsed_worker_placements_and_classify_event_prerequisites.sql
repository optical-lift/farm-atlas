alter table atlas.worker_day_task_placement_events
  drop constraint if exists worker_day_task_placement_events_event_kind_check;

alter table atlas.worker_day_task_placement_events
  add constraint worker_day_task_placement_events_event_kind_check
  check (event_kind = any (array[
    'atlas_placed'::text,
    'atlas_elapsed_return'::text,
    'owner_added'::text,
    'owner_rewindowed'::text,
    'owner_rescheduled'::text,
    'owner_reordered'::text,
    'owner_returned_to_atlas'::text,
    'owner_timed'::text,
    'owner_time_removed'::text,
    'owner_clock_plan_commit'::text,
    'occurrence_rebased'::text,
    'provenance_backfilled'::text
  ]));

create or replace function atlas.worker_day_placement_is_live_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_service_date date,
  p_as_of timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_local_date date := (coalesce(p_as_of,now()) at time zone 'America/Chicago')::date;
  v_local_time time := (coalesce(p_as_of,now()) at time zone 'America/Chicago')::time;
  v_capacity jsonb;
  v_end time;
begin
  if p_farm_id is null or p_membership_id is null or p_service_date is null then return false; end if;
  if p_service_date > v_local_date then return true; end if;
  if p_service_date < v_local_date then return false; end if;

  v_capacity := atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,p_service_date);
  if coalesce(v_capacity->>'state','')='non_working_day' then return false; end if;
  if nullif(v_capacity->>'localEnd','') is null then return true; end if;
  begin
    v_end := (v_capacity->>'localEnd')::time;
  exception when others then
    return true;
  end;
  return v_local_time <= v_end;
end;
$function$;

create or replace function atlas.sync_elapsed_worker_day_placements_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_row record;
  v_count integer := 0;
  v_minutes integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if p_farm_id is null or p_membership_id is null then
    raise exception 'Farm and membership are required.' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||'|'||p_membership_id::text||'|elapsed_worker_placements_v1',0));

  for v_row in
    select p.*,t.title,t.status,t.planned_occurrence_id as task_occurrence_id,
           coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0)::integer as claim_minutes
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id=p.task_id
    cross join lateral atlas.task_capacity_plan_v1(t,p.service_date) cp
    where p.farm_id=p_farm_id
      and p.membership_id=p_membership_id
      and p.state='placed'
      and t.status in ('open','blocked')
      and not atlas.worker_day_placement_is_live_v1(p.farm_id,p.membership_id,p.service_date,p_as_of)
    order by p.service_date,p.sort_order,p.task_id
    for update of p
  loop
    insert into atlas.worker_day_task_placement_events(
      organization_id,farm_id,membership_id,task_id,placement_id,event_kind,
      from_service_date,to_service_date,from_day_window,to_day_window,
      from_sort_order,to_sort_order,actor_user_id,metadata,
      from_planned_occurrence_id,to_planned_occurrence_id
    ) values (
      v_row.organization_id,v_row.farm_id,v_row.membership_id,v_row.task_id,v_row.id,'atlas_elapsed_return',
      v_row.service_date,null,v_row.day_window,null,
      v_row.sort_order,null,null,
      jsonb_build_object(
        'source','sync_elapsed_worker_day_placements_v1',
        'reason','Worker Day elapsed while task remained open or blocked; placement no longer claims a completed day.',
        'asOf',coalesce(p_as_of,now()),
        'priorPlannedStartAt',v_row.planned_start_at,
        'priorPlannedDurationMinutes',v_row.planned_duration_minutes,
        'claimMinutes',v_row.claim_minutes,
        'taskStatus',v_row.status
      ),
      coalesce(v_row.planned_occurrence_id,v_row.task_occurrence_id),null
    );

    update atlas.worker_day_task_placements
    set state='returned_to_atlas',
        placement_reason='Elapsed Worker Day ended while task remained open or blocked; returned to Atlas for lawful re-placement.',
        owner_actor_user_id=null,
        planned_start_at=null,
        planned_duration_minutes=null,
        updated_at=now()
    where id=v_row.id;

    v_count := v_count + 1;
    v_minutes := v_minutes + greatest(v_row.claim_minutes,0);
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'placementId',v_row.id,
      'taskId',v_row.task_id,
      'title',v_row.title,
      'formerServiceDate',v_row.service_date,
      'claimMinutes',v_row.claim_minutes,
      'state','returned_to_atlas'
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','sync_elapsed_worker_day_placements_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'asOf',coalesce(p_as_of,now()),
    'returnedCount',v_count,
    'returnedClaimMinutes',v_minutes,
    'placements',v_results,
    'truthBoundary',jsonb_build_object(
      'elapsedPlacementDoesNotProveTaskFruit',true,
      'openTaskReturnsToAtlasAfterWorkerDayEnds',true,
      'blockedTaskRetainsObligationButNotElapsedCapacityClaim',true
    )
  );
end;
$function$;

revoke all on function atlas.sync_elapsed_worker_day_placements_v1(uuid,uuid,timestamptz) from public,anon,authenticated;

create or replace function atlas.task_is_superseded_recurring_serving_v1(
  p_task_id uuid,
  p_as_of_date date default null::date
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_as_of date := coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then return false; end if;
  if coalesce(v_task.task_series_key,'')='' then return false; end if;
  if lower(coalesce(v_task.metadata->>'completion_independent_schedule','false')) not in ('true','yes','1') then return false; end if;

  return exists(
    select 1
    from atlas.tasks newer
    where newer.farm_id=v_task.farm_id
      and newer.id<>v_task.id
      and newer.task_series_key=v_task.task_series_key
      and newer.status in ('open','blocked','done')
      and coalesce(newer.due_date,date '-infinity') > coalesce(v_task.due_date,date '-infinity')
      and coalesce(newer.due_date,date 'infinity') <= v_as_of
  );
end;
$function$;

create or replace function atlas.task_delay_consequence_v1(p_task_id uuid, p_as_of_date date default null::date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_capacity record;
  v_as_of date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_explicit jsonb:='{}'::jsonb;
  v_tier integer;
  v_class text;
  v_source text;
  v_confidence text;
  v_basis jsonb:='[]'::jsonb;
  v_explicit_tier_text text;
  v_operation_class text;
  v_living_source boolean:=false;
  v_structural_living_intervention boolean:=false;
  v_canonical_upper date;
  v_needs_explicit boolean:=false;
  v_is_hard_date boolean:=false;
  v_grow_room_living boolean:=false;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;

  if v_task.planned_occurrence_id is not null then
    select * into v_occurrence from atlas.planned_work_occurrences where id=v_task.planned_occurrence_id;
  end if;
  select * into v_capacity from atlas.task_capacity_plan_v1(v_task,v_as_of);

  v_explicit:=coalesce(v_occurrence.miss_consequence,'{}'::jsonb);
  v_operation_class:=lower(coalesce(v_task.metadata->>'operation_class',v_task.operation_class,''));
  v_is_hard_date:=coalesce(v_task.commitment_kind,'')='hard_date'
    or lower(coalesce(v_task.metadata->>'date_behavior',''))='hard_date'
    or lower(coalesce(v_task.metadata->>'date_commitment',''))='hard_date'
    or lower(coalesce(v_task.metadata->>'calendar_commitment_kind',''))='owner_hard_date';

  if v_occurrence.latest_lawful_date is not null and v_occurrence.hard_finish_date is not null then
    v_canonical_upper:=least(v_occurrence.latest_lawful_date,v_occurrence.hard_finish_date);
  else
    v_canonical_upper:=coalesce(v_occurrence.latest_lawful_date,v_occurrence.hard_finish_date);
  end if;

  v_living_source:=coalesce(v_occurrence.source_kind,'') in (
    'production_succession','crop_cycle_milestone','crop_cycle_followup','germination_workflow',
    'germination_thinning','germination_harvest_watch','propagation_followup','propagation_split',
    'sowing_bed_checklist','spring_snapdragon_stagger_2027','retroactive_crop_profile'
  );
  v_grow_room_living:=lower(coalesce(v_task.metadata->>'grow_room_round_linked','false')) in ('true','yes','1')
    and v_operation_class in ('establish_aboveground','inspect_assess','remove_uproot','water_nourish');
  v_structural_living_intervention:=
    (
      coalesce(v_occurrence.source_kind,'') in ('propagation_split','propagation_followup','germination_workflow','germination_thinning')
      and v_operation_class in ('establish_aboveground','inspect_assess','remove_uproot','water_nourish')
    )
    or (
      coalesce(v_occurrence.source_kind,'')='germination_harvest_watch'
      and v_operation_class in ('harvest_aboveground','inspect_assess')
    )
    or (
      coalesce(v_occurrence.source_kind,'') in ('production_succession','crop_cycle_milestone','crop_cycle_followup','sowing_bed_checklist')
      and v_operation_class in ('establish_aboveground','divide_reestablish_belowground','harvest_aboveground')
    );

  if v_explicit<>'{}'::jsonb then
    v_explicit_tier_text:=coalesce(v_explicit->>'tier',v_explicit->>'tierNumber');
    if coalesce(v_explicit_tier_text,'') ~ '^[1-6]$' then v_tier:=v_explicit_tier_text::integer; end if;
    v_class:=nullif(lower(coalesce(v_explicit->>'class',v_explicit->>'consequenceClass','')),'');
    if v_tier is null then
      v_tier:=case v_class
        when 'irreversible_living_loss' then 1
        when 'biological_deadline' then 2
        when 'prerequisite_unlock' then 3
        when 'revenue_commitment' then 4
        when 'recurring_maintenance' then 5
        when 'routine_production' then 5
        when 'improvement_side_project' then 6
        else null end;
    end if;
    v_class:=coalesce(v_class,case when v_tier is not null then 'explicit_tier_'||v_tier::text else 'explicit_unparsed' end);
    v_source:='occurrence_miss_consequence';
    v_confidence:=case when v_tier is not null then 'explicit' else 'unresolved' end;
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','explicit_miss_consequence','value',v_explicit));
    v_needs_explicit:=v_tier is null;
  elsif coalesce(v_task.metadata->>'sale_channel','')<>''
     or lower(coalesce(v_task.metadata->>'revenue_commitment','false')) in ('true','yes','1') then
    v_tier:=4; v_class:='revenue_commitment'; v_source:='task_revenue_contract'; v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','revenue_contract_metadata'));
  elsif v_task.task_type='event_setup'
     and nullif(v_task.metadata->>'community_event_id','') is not null
     and nullif(v_task.metadata->>'community_event_date','') is not null then
    v_tier:=3; v_class:='prerequisite_unlock'; v_source:='community_event_readiness_contract'; v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'code','community_event_readiness_prerequisite',
      'communityEventId',v_task.metadata->>'community_event_id',
      'communityEventDate',v_task.metadata->>'community_event_date',
      'visitWindowEnd',v_task.metadata->>'visit_window_end'
    )));
  elsif v_living_source and v_canonical_upper is not null then
    v_tier:=2; v_class:='biological_deadline'; v_source:='canonical_living_window'; v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','living_source_with_canonical_upper_bound','sourceKind',v_occurrence.source_kind,'latestLawfulDate',v_occurrence.latest_lawful_date,'hardFinishDate',v_occurrence.hard_finish_date));
  elsif v_grow_room_living then
    v_tier:=2; v_class:='biological_deadline'; v_source:='living_propagation_contract'; v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','grow_room_living_intervention','operationClass',v_operation_class,'growRoomRoundLinked',true));
  elsif v_structural_living_intervention then
    v_tier:=2; v_class:='biological_deadline'; v_source:='production_lifecycle_contract'; v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','living_lifecycle_intervention','sourceKind',v_occurrence.source_kind,'operationClass',v_operation_class));
  elsif coalesce(v_task.work_lane,'')='rhythm'
     or coalesce(v_occurrence.source_kind,'') in ('recurring_task','rhythm_state','maintenance_weeding_collection','weed_card','walkway_card_collection') then
    v_tier:=5; v_class:='recurring_maintenance'; v_source:='recurring_continuity_contract'; v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','recurring_or_rhythm_contract','sourceKind',v_occurrence.source_kind));
  elsif coalesce(v_capacity.effective_obligation_class,'')='routine_production'
     and coalesce(v_task.work_lane,'')='discretionary' then
    v_tier:=5; v_class:='routine_production'; v_source:='routine_production_contract'; v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','routine_production_without_known_deadline'));
  elsif coalesce(v_capacity.effective_obligation_class,'')='optional_improvement'
     or coalesce(v_occurrence.source_kind,'') in ('project_pull_item','owner_project')
     or (coalesce(v_task.work_lane,'')='discretionary' and coalesce(v_capacity.effective_obligation_class,'')<>'routine_production')
     or (
       coalesce(v_task.work_lane,'')='process_continuation'
       and coalesce(v_task.commitment_kind,'') in ('persistent','floating')
       and v_operation_class in ('clean_restore','build_establish_structure')
     ) then
    v_tier:=6; v_class:='improvement_side_project'; v_source:='optional_improvement_contract'; v_confidence:='structural';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','structural_improvement_contract','workLane',v_task.work_lane,'commitmentKind',v_task.commitment_kind,'operationClass',v_operation_class));
  elsif coalesce(v_task.commitment_kind,'')='dependency' or coalesce(v_task.work_lane,'')='process_continuation' then
    v_tier:=null; v_class:='dependency_consequence_unresolved'; v_source:='dependency_contract'; v_confidence:='unresolved';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','dependency_requires_downstream_consequence'));
    v_needs_explicit:=true;
  elsif v_is_hard_date then
    v_tier:=null; v_class:='hard_date_consequence_unresolved'; v_source:='hard_date_target_only'; v_confidence:='unresolved';
    v_basis:=v_basis||jsonb_build_array(jsonb_build_object('code','hard_date_does_not_identify_consequence'));
    v_needs_explicit:=true;
  else
    v_tier:=null; v_class:='unclassified'; v_source:='insufficient_structural_evidence'; v_confidence:='unresolved'; v_needs_explicit:=true;
  end if;

  return jsonb_build_object(
    'contractVersion','task_delay_consequence_v1','taskId',v_task.id,'asOfDate',v_as_of,
    'directTier',v_tier,'directClass',v_class,'source',v_source,'confidence',v_confidence,'basis',v_basis,
    'needsExplicitConsequence',v_needs_explicit,'canonicalMissConsequence',v_explicit,
    'plannedOccurrenceId',v_task.planned_occurrence_id,'occurrenceSourceKind',v_occurrence.source_kind,
    'operationClass',nullif(v_operation_class,''),'workLane',v_task.work_lane,'commitmentKind',v_task.commitment_kind,
    'effectiveObligationClass',v_capacity.effective_obligation_class,'canonicalUpperBound',v_canonical_upper
  );
end;
$function$;