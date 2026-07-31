-- Govern Elm's indoor guest readiness through one venue Clock and room-level observations.

create table if not exists atlas.guest_readiness_rounds (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id),
  zone_id uuid not null references atlas.zones(id),
  task_id uuid references atlas.tasks(id),
  round_key text not null,
  aggregate_outcome text not null check (aggregate_outcome in ('ready','small_reset_needed','not_guest_ready','problem','closed')),
  observed_at timestamptz not null default now(),
  note text,
  created_by_user_id uuid,
  effective_membership_id uuid references atlas.farm_memberships(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id, round_key)
);

create table if not exists atlas.guest_readiness_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id),
  zone_id uuid not null references atlas.zones(id),
  object_id uuid not null references atlas.growing_objects(id),
  round_id uuid not null references atlas.guest_readiness_rounds(id),
  task_id uuid references atlas.tasks(id),
  outcome text not null check (outcome in ('ready','small_reset_needed','not_guest_ready','event_damage_or_problem','closed_not_in_use')),
  observed_at timestamptz not null default now(),
  note text,
  created_by_user_id uuid,
  effective_membership_id uuid references atlas.farm_memberships(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (round_id, object_id)
);

create table if not exists atlas.guest_readiness_room_state (
  object_id uuid primary key references atlas.growing_objects(id),
  farm_id uuid not null references atlas.farms(id),
  zone_id uuid not null references atlas.zones(id),
  status text not null check (status in ('unassessed','ready','small_reset_needed','not_guest_ready','problem','closed')),
  source_event_id uuid references atlas.guest_readiness_events(id),
  last_observed_at timestamptz,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table atlas.guest_readiness_rounds enable row level security;
alter table atlas.guest_readiness_events enable row level security;
alter table atlas.guest_readiness_room_state enable row level security;

drop policy if exists guest_readiness_rounds_member_read on atlas.guest_readiness_rounds;
create policy guest_readiness_rounds_member_read on atlas.guest_readiness_rounds
for select to authenticated using (atlas.is_farm_member(farm_id));

drop policy if exists guest_readiness_events_member_read on atlas.guest_readiness_events;
create policy guest_readiness_events_member_read on atlas.guest_readiness_events
for select to authenticated using (atlas.is_farm_member(farm_id));

drop policy if exists guest_readiness_room_state_member_read on atlas.guest_readiness_room_state;
create policy guest_readiness_room_state_member_read on atlas.guest_readiness_room_state
for select to authenticated using (atlas.is_farm_member(farm_id));

revoke insert,update,delete on atlas.guest_readiness_rounds from anon,authenticated;
revoke insert,update,delete on atlas.guest_readiness_events from anon,authenticated;
revoke insert,update,delete on atlas.guest_readiness_room_state from anon,authenticated;
grant select on atlas.guest_readiness_rounds,atlas.guest_readiness_events,atlas.guest_readiness_room_state to authenticated;

create or replace function atlas.prevent_guest_readiness_history_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
begin
  raise exception 'Guest readiness history is append-only; record a new round instead.';
end;
$$;

drop trigger if exists guest_readiness_rounds_append_only_v1 on atlas.guest_readiness_rounds;
create trigger guest_readiness_rounds_append_only_v1
before update or delete on atlas.guest_readiness_rounds
for each row execute function atlas.prevent_guest_readiness_history_mutation_v1();

drop trigger if exists guest_readiness_events_append_only_v1 on atlas.guest_readiness_events;
create trigger guest_readiness_events_append_only_v1
before update or delete on atlas.guest_readiness_events
for each row execute function atlas.prevent_guest_readiness_history_mutation_v1();

create or replace function atlas.link_guest_readiness_rooms_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
begin
  if new.task_type <> 'guest_readiness_round' or new.status='archived' then return new; end if;
  insert into atlas.task_objects(task_id,object_id,role)
  select new.id,go.id,'readiness_room'
  from atlas.growing_objects go
  where go.farm_id=new.farm_id
    and go.stable_key in ('venue_entry','venue_bathroom','venue_kitchen','venue_lounge','venue_library','venue_conference_room','venue_studio')
  on conflict (task_id,object_id) do update set role=excluded.role;
  return new;
end;
$$;

drop trigger if exists tasks_link_guest_readiness_rooms_v1 on atlas.tasks;
create trigger tasks_link_guest_readiness_rooms_v1
after insert or update of task_type,status on atlas.tasks
for each row execute function atlas.link_guest_readiness_rooms_v1();

create or replace function atlas.decorate_biological_clock_task_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_rhythm text := coalesce(new.metadata->>'rhythm_key','');
  v_state_id uuid := atlas.rhythm_safe_uuid_v1(new.metadata->>'rhythm_state_id');
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_zone atlas.zones%rowtype;
begin
  if new.generated_from <> 'rhythm_clock' or v_state_id is null then return new; end if;

  if v_rhythm='grow_room_care' then
    new.title := 'Grow Room Care';
    new.task_type := 'grow_room_care';
    new.action_key := 'grow_room_round';
    new.work_class := 'standard';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'manual_top_level_card',true,'round_completion_required',true,
      'display_action','Care round','display_subject','Grow Room','collection_zone','Grow Room',
      'work_rhythm','Grow Room Care','time_claims_physical_condition',false
    );
  elsif v_rhythm='guest_readiness' then
    select z.* into v_zone
    from atlas.rhythm_state rs join atlas.zones z on z.id=rs.subject_id
    where rs.id=v_state_id and rs.subject_kind='zone';
    new.title := case
      when lower(coalesce(new.metadata->>'initial_guest_readiness_acceptance','false')) in ('true','yes','1') then 'Final clean, photograph + Guest Readiness acceptance'
      when coalesce(new.metadata->>'rhythm_target_state','')='fallen_out_of_rhythm' then 'Restore guest readiness — '||coalesce(nullif(v_zone.label,''),'Venue')
      else 'Guest readiness walk — '||coalesce(nullif(v_zone.label,''),'Venue') end;
    new.task_type := 'guest_readiness_round';
    new.action_key := 'guest_readiness';
    new.work_class := 'light';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'task_style','guest_readiness_round','structured_result_required',true,
      'venue_zone_id',v_zone.id,'venue_zone_label',v_zone.label,
      'display_action','Check guest readiness','display_subject',coalesce(nullif(v_zone.label,''),'Venue'),
      'display_detail','Entry · Bathroom · Kitchen · Lounge · Library · Conference Room · Studio',
      'collection_zone',coalesce(nullif(v_zone.label,''),'Venue'),
      'work_rhythm','Guest Readiness','time_claims_physical_condition',false
    );
  elsif v_rhythm in ('germination_watch','harvest_watch') then
    select cc.* into v_cycle
    from atlas.rhythm_state rs join atlas.crop_cycles cc on cc.id=rs.subject_id
    where rs.id=v_state_id and rs.subject_kind='crop_cycle';
    if v_cycle.id is not null then
      select * into v_object from atlas.growing_objects where id=v_cycle.object_id;
      if v_rhythm='germination_watch' then
        new.title := 'Check germination — '||coalesce(nullif(v_cycle.crop_label,''),'Crop')||' · '||coalesce(nullif(v_object.label,''),'Growing area');
        new.task_type := 'germination_check';
        new.action_key := 'germination_check';
        new.work_class := 'crop_cycle';
        new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
          'task_style','germination_check','milestone','germination_check',
          'crop_cycle_id',v_cycle.id,'crop_cycle_key',v_cycle.crop_cycle_key,'crop_label',v_cycle.crop_label,'variety',v_cycle.variety,
          'object_id',v_cycle.object_id,'object_label',v_object.label,
          'expected_germination_start',v_cycle.expected_germination_start,'expected_germination_end',v_cycle.expected_germination_end,
          'display_action','Check germination','display_subject',coalesce(nullif(v_cycle.variety,''),v_cycle.crop_label),
          'collection_zone',v_object.label,'time_claims_physical_condition',false
        );
      else
        new.title := 'Harvest watch — '||coalesce(nullif(v_cycle.variety,''),nullif(v_cycle.crop_label,''),'Crop')||' · '||coalesce(nullif(v_object.label,''),'Growing area');
        new.task_type := 'harvest_watch';
        new.action_key := 'harvest_watch';
        new.work_class := 'crop_cycle';
        new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
          'task_style','harvest_watch','milestone','harvest_watch','structured_result_required',true,
          'crop_cycle_id',v_cycle.id,'crop_cycle_key',v_cycle.crop_cycle_key,'crop_label',v_cycle.crop_label,'variety',v_cycle.variety,
          'object_id',v_cycle.object_id,'object_label',v_object.label,
          'expected_harvest_watch_start',v_cycle.expected_harvest_watch_start,'expected_harvest_watch_end',v_cycle.expected_harvest_watch_end,
          'display_action','Check harvest stage','display_subject',coalesce(nullif(v_cycle.variety,''),v_cycle.crop_label),
          'collection_zone',v_object.label,'time_claims_physical_condition',false
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function atlas.record_guest_readiness_round_core_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_results jsonb,
  p_note text,
  p_idempotency_key text,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare
  v_task atlas.tasks%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_owner_membership_id uuid;
  v_zone_id uuid;
  v_state atlas.rhythm_state%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_existing_round atlas.guest_readiness_rounds%rowtype;
  v_round_id uuid;
  v_round_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_round_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_result jsonb;
  v_object_id uuid;
  v_outcome text;
  v_room_note text;
  v_seen uuid[] := '{}';
  v_total integer;
  v_ready integer := 0;
  v_reset integer := 0;
  v_not_ready integer := 0;
  v_problem integer := 0;
  v_closed integer := 0;
  v_aggregate text;
  v_event_id uuid;
  v_satisfaction_id uuid;
  v_transition jsonb;
  v_clock jsonb;
  v_rhythm_transition_id uuid;
  v_role text := lower(coalesce(p_effective_role,''));
  v_now timestamptz := now();
begin
  if p_task_id is null or p_effective_membership_id is null or v_round_key is null or length(v_round_key)>160 then
    raise exception 'Task, active membership, and idempotency key are required.' using errcode='22023';
  end if;
  if p_results is null or jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)=0 then
    raise exception 'Record a readiness result for every room.' using errcode='22023';
  end if;
  if v_round_note is not null and length(v_round_note)>4000 then
    raise exception 'Round note must be 4000 characters or fewer.' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Guest readiness task was not found.' using errcode='P0002'; end if;
  if v_task.task_type<>'guest_readiness_round' or v_task.status not in ('open','blocked') then
    raise exception 'This task is not an open Guest Readiness round.' using errcode='22023';
  end if;

  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id and active;
  if v_membership.id is null or v_membership.farm_id<>v_task.farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if not p_operator_mode and (auth.uid() is null or v_membership.user_id<>auth.uid()) then
    raise exception 'This membership does not belong to the signed-in player.' using errcode='42501';
  end if;
  if v_role not in ('owner','manager') and not (
    v_role='farm_hand' and v_task.visibility_scope='assigned_worker' and v_task.assigned_membership_id=v_membership.id
  ) then
    raise exception 'This Guest Readiness round is outside the active player context.' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_task.farm_id::text||':guest-readiness:'||v_round_key,0));
  select * into v_existing_round from atlas.guest_readiness_rounds where farm_id=v_task.farm_id and round_key=v_round_key;
  if v_existing_round.id is not null then
    return jsonb_build_object('roundId',v_existing_round.id,'taskId',v_existing_round.task_id,'aggregateOutcome',v_existing_round.aggregate_outcome,'deduplicated',true);
  end if;

  select z.id into v_zone_id from atlas.zones z where z.farm_id=v_task.farm_id and z.stable_key='venue';
  if v_zone_id is null then raise exception 'Venue zone was not found.' using errcode='P0002'; end if;

  select count(*) into v_total
  from atlas.task_objects tro join atlas.growing_objects go on go.id=tro.object_id
  where tro.task_id=v_task.id and tro.role='readiness_room' and go.guest_visible and go.object_type='room';
  if v_total=0 then raise exception 'This round has no guest rooms.' using errcode='22023'; end if;
  if jsonb_array_length(p_results)<>v_total then
    raise exception 'Record one result for each of the % guest rooms.',v_total using errcode='22023';
  end if;

  for v_result in select value from jsonb_array_elements(p_results)
  loop
    begin v_object_id := nullif(v_result->>'objectId','')::uuid; exception when others then v_object_id:=null; end;
    v_outcome := nullif(btrim(coalesce(v_result->>'outcome','')),'');
    v_room_note := nullif(btrim(coalesce(v_result->>'note','')),'');
    if v_object_id is null or v_outcome not in ('ready','small_reset_needed','not_guest_ready','event_damage_or_problem','closed_not_in_use') then
      raise exception 'Every room needs a valid readiness result.' using errcode='22023';
    end if;
    if v_object_id=any(v_seen) then raise exception 'A room may appear only once in a readiness round.' using errcode='22023'; end if;
    v_seen:=array_append(v_seen,v_object_id);
    if not exists (
      select 1 from atlas.task_objects tro join atlas.growing_objects go on go.id=tro.object_id
      where tro.task_id=v_task.id and tro.object_id=v_object_id and tro.role='readiness_room' and go.guest_visible and go.object_type='room'
    ) then raise exception 'A submitted room is not part of this readiness round.' using errcode='22023'; end if;
    if v_outcome in ('small_reset_needed','not_guest_ready','event_damage_or_problem') and v_room_note is null then
      raise exception 'Describe what this room needs.' using errcode='22023';
    end if;
    if v_outcome='closed_not_in_use' and v_role not in ('owner','manager') then
      raise exception 'Only the Owner or manager may close a venue room.' using errcode='42501';
    end if;
    case v_outcome
      when 'ready' then v_ready:=v_ready+1;
      when 'small_reset_needed' then v_reset:=v_reset+1;
      when 'not_guest_ready' then v_not_ready:=v_not_ready+1;
      when 'event_damage_or_problem' then v_problem:=v_problem+1;
      when 'closed_not_in_use' then v_closed:=v_closed+1;
    end case;
  end loop;

  v_aggregate := case
    when v_problem>0 then 'problem'
    when v_not_ready>0 then 'not_guest_ready'
    when v_reset>0 then 'small_reset_needed'
    when v_closed=v_total then 'closed'
    else 'ready'
  end;

  insert into atlas.guest_readiness_rounds(
    farm_id,zone_id,task_id,round_key,aggregate_outcome,observed_at,note,created_by_user_id,effective_membership_id,metadata
  ) values (
    v_task.farm_id,v_zone_id,v_task.id,v_round_key,v_aggregate,v_now,v_round_note,auth.uid(),v_membership.id,
    jsonb_build_object('operatorMode',p_operator_mode,'effectiveRole',v_role,'roomCount',v_total,'readyCount',v_ready,'resetCount',v_reset,'notReadyCount',v_not_ready,'problemCount',v_problem,'closedCount',v_closed,'timeClaimsPhysicalCondition',false)
  ) returning id into v_round_id;

  for v_result in select value from jsonb_array_elements(p_results)
  loop
    v_object_id := (v_result->>'objectId')::uuid;
    v_outcome := v_result->>'outcome';
    v_room_note := nullif(btrim(coalesce(v_result->>'note','')),'');
    insert into atlas.guest_readiness_events(
      farm_id,zone_id,object_id,round_id,task_id,outcome,observed_at,note,created_by_user_id,effective_membership_id,metadata
    ) values (
      v_task.farm_id,v_zone_id,v_object_id,v_round_id,v_task.id,v_outcome,v_now,v_room_note,auth.uid(),v_membership.id,
      jsonb_build_object('operatorMode',p_operator_mode,'effectiveRole',v_role,'timeClaimsPhysicalCondition',false)
    ) returning id into v_event_id;

    insert into atlas.guest_readiness_room_state(object_id,farm_id,zone_id,status,source_event_id,last_observed_at,note,metadata,updated_at)
    values (
      v_object_id,v_task.farm_id,v_zone_id,
      case v_outcome when 'event_damage_or_problem' then 'problem' when 'closed_not_in_use' then 'closed' else v_outcome end,
      v_event_id,v_now,v_room_note,jsonb_build_object('roundId',v_round_id,'taskId',v_task.id,'observedByMembershipId',v_membership.id),v_now
    ) on conflict (object_id) do update set
      status=excluded.status,source_event_id=excluded.source_event_id,last_observed_at=excluded.last_observed_at,note=excluded.note,
      metadata=atlas.guest_readiness_room_state.metadata||excluded.metadata,updated_at=excluded.updated_at;

    update atlas.growing_objects set
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'guest_readiness_status',case v_outcome when 'event_damage_or_problem' then 'problem' when 'closed_not_in_use' then 'closed' else v_outcome end,
        'guest_readiness_observed_at',v_now,'guest_readiness_source_event_id',v_event_id
      ),updated_at=v_now
    where id=v_object_id;
  end loop;

  select rs.* into v_state
  from atlas.rhythm_state rs
  where rs.farm_id=v_task.farm_id and rs.rhythm_key='guest_readiness' and rs.subject_kind='zone' and rs.subject_id=v_zone_id
  for update;
  if v_state.id is null then raise exception 'Guest Readiness Clock state was not found.' using errcode='P0002'; end if;
  select * into v_rule from atlas.rhythm_rules where id=v_state.rhythm_rule_id;

  update atlas.zones set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'guest_readiness_status',v_aggregate,'guest_readiness_observed_at',v_now,'guest_readiness_round_id',v_round_id
  ),updated_at=v_now where id=v_zone_id;

  if v_aggregate='ready' then
    insert into atlas.rhythm_satisfactions(
      organization_id,farm_id,rhythm_state_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,subject_kind,subject_id,
      satisfaction_key,satisfaction_kind,satisfied_at,renewal_interval_seconds,source_kind,source_id,source_event,
      source_task_id,policy_match,evidence,created_by_user_id
    ) values (
      v_state.organization_id,v_state.farm_id,v_state.id,v_state.rhythm_binding_id,v_state.rhythm_rule_id,v_state.rhythm_key,v_state.subject_kind,v_state.subject_id,
      'guest-readiness:'||v_round_id::text,'full',v_now,v_rule.validity_interval_seconds,'guest_readiness_round',v_round_id,'ready',
      v_task.id,jsonb_build_object('matched',true,'policy','guest_readiness_round_ready_v1'),
      jsonb_build_object('roundId',v_round_id,'roomCount',v_total,'readyCount',v_ready,'closedCount',v_closed,'timeClaimsPhysicalCondition',false),auth.uid()
    ) on conflict (farm_id,satisfaction_key) do update set satisfaction_key=excluded.satisfaction_key
    returning id into v_satisfaction_id;

    update atlas.rhythm_state set last_qualifying_satisfaction_id=v_satisfaction_id,current_task_id=null,current_occurrence_id=null,updated_at=v_now where id=v_state.id;
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done','guest-readiness:'||v_round_key||':done',null,v_round_note,null,'guest_readiness','readiness_round',jsonb_build_object('guest_readiness_round_id',v_round_id,'aggregate_outcome',v_aggregate),null);
    v_clock:=atlas.evaluate_rhythm_binding_v1(v_state.id,v_now,'guest_readiness_result');
  elsif v_aggregate='closed' then
    update atlas.rhythm_bindings set active=false,active_until=v_now,owner_reason=coalesce(v_round_note,'Venue closed through Guest Readiness round.'),updated_at=v_now where id=v_state.rhythm_binding_id;
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done','guest-readiness:'||v_round_key||':closed',null,v_round_note,null,'guest_readiness','readiness_round',jsonb_build_object('guest_readiness_round_id',v_round_id,'aggregate_outcome',v_aggregate),null);
    update atlas.rhythm_state set current_task_id=null,current_occurrence_id=null,updated_at=v_now where id=v_state.id;
    v_clock:=atlas.evaluate_rhythm_binding_v1(v_state.id,v_now,'guest_readiness_closed');
  else
    if v_state.state<>'recovering' then
      v_rhythm_transition_id:=atlas.record_rhythm_transition_v1(
        v_state.id,'guest-readiness:'||v_round_id::text||':recovering','recovering',v_state.state,'recovering','partial_result',v_now,v_now,null,v_task.id,v_task.planned_occurrence_id,
        jsonb_build_object('roundId',v_round_id,'aggregateOutcome',v_aggregate,'timeClaimsPhysicalCondition',false)
      );
    end if;
    update atlas.rhythm_state set state='recovering',recovery_started_at=coalesce(recovery_started_at,v_now),current_task_id=v_task.id,current_occurrence_id=v_task.planned_occurrence_id,
      state_reason=jsonb_build_object('source','guest_readiness_round','roundId',v_round_id,'aggregateOutcome',v_aggregate),updated_at=v_now where id=v_state.id;

    if v_aggregate='small_reset_needed' then
      v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'partial','guest-readiness:'||v_round_key||':partial',null,coalesce(v_round_note,'Small venue reset still needed.'),null,'guest_readiness','readiness_round',jsonb_build_object('guest_readiness_round_id',v_round_id,'aggregate_outcome',v_aggregate),null);
    else
      v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'blocked','guest-readiness:'||v_round_key||':blocked',null,coalesce(v_round_note,'Venue is not guest-ready.'),'Guest Readiness observation requires Owner attention.','guest_readiness','owner_handoff',jsonb_build_object('guest_readiness_round_id',v_round_id,'aggregate_outcome',v_aggregate),null);
      if v_role<>'owner' then
        select id into v_owner_membership_id from atlas.farm_memberships where farm_id=v_task.farm_id and role='owner' and active order by created_at limit 1;
        if v_owner_membership_id is not null then
          update atlas.tasks set assigned_membership_id=v_owner_membership_id,visibility_scope='assigned_worker',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'assignee_key','owner','guest_readiness_owner_handoff',true,'guest_readiness_round_id',v_round_id,'guest_readiness_issue',coalesce(v_round_note,'Venue is not guest-ready.')
          ),updated_at=v_now where id=v_task.id;
        end if;
      end if;
    end if;
    update atlas.rhythm_state set state='recovering',recovery_started_at=coalesce(recovery_started_at,v_now),current_task_id=v_task.id,current_occurrence_id=v_task.planned_occurrence_id,
      state_reason=jsonb_build_object('source','guest_readiness_round','roundId',v_round_id,'aggregateOutcome',v_aggregate),updated_at=v_now where id=v_state.id;
  end if;

  return jsonb_build_object(
    'roundId',v_round_id,'taskId',v_task.id,'aggregateOutcome',v_aggregate,
    'readyCount',v_ready,'resetCount',v_reset,'notReadyCount',v_not_ready,'problemCount',v_problem,'closedCount',v_closed,
    'taskTransition',v_transition,'clock',v_clock,'deduplicated',false
  );
end;
$$;

create or replace function atlas.record_guest_readiness_round_for_member_v1(
  p_farm_id uuid,p_task_id uuid,p_results jsonb,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare v_role text;v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id);v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_guest_readiness_round_core_v1(p_task_id,v_membership,v_role,p_results,p_note,p_idempotency_key,false);
end;
$$;

create or replace function atlas.owner_operator_record_guest_readiness_round_v1(
  p_effective_membership_id uuid,p_task_id uuid,p_results jsonb,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_guest_readiness_round_core_v1(
    p_task_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_results,p_note,p_idempotency_key,true
  );
end;
$$;

revoke all on function atlas.record_guest_readiness_round_core_v1(uuid,uuid,text,jsonb,text,text,boolean) from public,anon,authenticated;
revoke all on function atlas.record_guest_readiness_round_for_member_v1(uuid,uuid,jsonb,text,text) from public,anon;
revoke all on function atlas.owner_operator_record_guest_readiness_round_v1(uuid,uuid,jsonb,text,text) from public,anon;
grant execute on function atlas.record_guest_readiness_round_for_member_v1(uuid,uuid,jsonb,text,text) to authenticated;
grant execute on function atlas.owner_operator_record_guest_readiness_round_v1(uuid,uuid,jsonb,text,text) to authenticated;

create or replace function atlas.biological_rhythm_dashboard_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=pg_catalog,atlas
as $$
declare v_items jsonb;
begin
  if auth.uid() is null or not atlas.is_farm_owner(p_farm_id) then raise exception 'Only a farm Owner may read farm rhythm controls.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'stateId',rs.id,'bindingId',rs.rhythm_binding_id,'ruleId',rr.id,'rhythmKey',rs.rhythm_key,'ruleKey',rr.rule_key,'ruleLabel',rr.label,'ruleVersion',rr.version,
    'subjectKind',rs.subject_kind,'subjectId',rs.subject_id,
    'subjectLabel',case
      when rs.subject_kind='growing_object' then (select label from atlas.growing_objects where id=rs.subject_id)
      when rs.subject_kind='crop_cycle' then (select concat_ws(' · ',coalesce(nullif(variety,''),crop_label),(select label from atlas.growing_objects where id=object_id)) from atlas.crop_cycles where id=rs.subject_id)
      when rs.subject_kind='zone' then (select label from atlas.zones where id=rs.subject_id)
      else rs.subject_id::text end,
    'state',rs.state,'warningAt',rs.warning_at,'dueAt',rs.due_at,'failureAt',rs.failure_at,'currentTaskId',rs.current_task_id,'bindingActive',rb.active,
    'validitySeconds',rr.validity_interval_seconds,'warningSeconds',rr.warning_window_seconds,'graceSeconds',rr.grace_window_seconds,
    'why',case
      when rs.rhythm_key='grow_room_care' then 'A completed Grow Room round keeps this rhythm valid. Time can open another care round, but it never claims the room is dry or healthy.'
      when rs.rhythm_key='germination_watch' then 'A sowing opened a germination watch. Only a recorded germination observation renews or closes it; manual rescheduling does not.'
      when rs.rhythm_key='harvest_watch' then 'A real planting and harvest window opened this watch. Time asks for an observation; only a field result may declare the crop ready, declining, or finished.'
      else 'A completed room-by-room Guest Readiness round keeps the venue in rhythm. Time can require another walk, but it never claims a room is dirty or ready.' end,
    'controls',jsonb_build_object('pauseAppliesToRule',true,'canExtendState',true,'canForgiveState',true,'canReviseRule',true)
  ) order by rs.rhythm_key,rs.due_at nulls last),'[]'::jsonb) into v_items
  from atlas.rhythm_state rs join atlas.rhythm_rules rr on rr.id=rs.rhythm_rule_id join atlas.rhythm_bindings rb on rb.id=rs.rhythm_binding_id
  where rs.farm_id=p_farm_id and rs.rhythm_key in ('grow_room_care','germination_watch','harvest_watch','guest_readiness');
  return jsonb_build_object('contractVersion','biological_rhythm_dashboard_v1','farmId',p_farm_id,'items',v_items);
end;
$$;

do $$
declare
  v_farm atlas.farms%rowtype;
  v_zone atlas.zones%rowtype;
  v_owner atlas.farm_memberships%rowtype;
  v_worker atlas.farm_memberships%rowtype;
  v_rule_id uuid;
  v_binding_id uuid;
  v_state_id uuid;
  v_task atlas.tasks%rowtype;
begin
  select * into v_farm from atlas.farms where stable_key='elm_farm';
  select * into v_zone from atlas.zones where farm_id=v_farm.id and stable_key='venue';
  select * into v_owner from atlas.farm_memberships where farm_id=v_farm.id and role='owner' and active order by created_at limit 1;
  select * into v_worker from atlas.farm_memberships where farm_id=v_farm.id and worker_key='anna' and active order by created_at limit 1;

  select id into v_rule_id from atlas.rhythm_rules where farm_id=v_farm.id and rule_key='elm_venue_guest_readiness' and version=1;
  if v_rule_id is null then
    insert into atlas.rhythm_rules(
      organization_id,farm_id,rule_key,rhythm_key,version,label,status,applicability,
      validity_interval_seconds,warning_window_seconds,grace_window_seconds,qualifying_touches,failure_consequence,player_routing,
      created_by_user_id,activated_at,owner_reason,metadata
    ) values (
      v_farm.organization_id,v_farm.id,'elm_venue_guest_readiness','guest_readiness',1,'Guest readiness','active',
      jsonb_build_object('subjectKind','zone','zoneKey','venue','roomKeys',jsonb_build_array('venue_entry','venue_bathroom','venue_kitchen','venue_lounge','venue_library','venue_conference_room','venue_studio')),
      259200,86400,86400,
      jsonb_build_array(jsonb_build_object('sourceKind','guest_readiness_round','sourceEvent','ready','renewal','full')),
      jsonb_build_object(
        'dueTask',jsonb_build_object('title','Guest readiness walk — Venue','taskType','guest_readiness_round','priority','normal','actionKey','guest_readiness','workClass','light','visibilityScope','assigned_worker','assignedMembershipId',v_worker.id,'note','Walk each guest room and record what is physically true. Time opened the walk; it did not decide the result.'),
        'failureTask',jsonb_build_object('title','Restore guest readiness — Venue','taskType','guest_readiness_round','priority','high','actionKey','guest_readiness','workClass','light','visibilityScope','assigned_worker','assignedMembershipId',v_worker.id,'note','The last verified venue state expired. Walk every room and restore or report what is not guest-ready.'),
        'timeClaimsPhysicalCondition',false
      ),
      jsonb_build_object('visibilityScope','assigned_worker','assignedMembershipId',v_worker.id,'assignedUserId',v_worker.user_id,'dueRecipient','responsible_worker','failureEscalation','owner'),
      v_owner.user_id,now(),'First indoor Guest Readiness rule for Elm venue rooms.',
      jsonb_build_object('timezoneName','America/Chicago','boundaryMode','local_day','domain','hospitality','timeClaimsPhysicalCondition',false,'validityMeaning','A room-by-room readiness observation remains current for three local days.')
    ) returning id into v_rule_id;
  end if;

  select id into v_binding_id from atlas.rhythm_bindings where farm_id=v_farm.id and binding_key='elm:venue:guest_readiness';
  if v_binding_id is null then
    insert into atlas.rhythm_bindings(
      organization_id,farm_id,rhythm_rule_id,binding_key,inheritance_layer,subject_kind,subject_id,subject_key,priority,active_from,active,created_by_user_id,owner_reason,metadata
    ) values (
      v_farm.organization_id,v_farm.id,v_rule_id,'elm:venue:guest_readiness','zone_modifier','zone',v_zone.id,v_zone.stable_key,100,now(),true,v_owner.user_id,
      'The indoor venue is governed as one calm readiness round with room-level physical results.',jsonb_build_object('roomCount',7,'domain','hospitality')
    ) returning id into v_binding_id;
  end if;

  select * into v_task from atlas.tasks where farm_id=v_farm.id and metadata->>'task_key'='owner_20260808_final_clean_photos_acceptance' limit 1;
  if v_task.id is not null then
    update atlas.tasks set
      title='Final clean, photograph + Guest Readiness acceptance',
      zone_id=v_zone.id,task_type='guest_readiness_round',action_key='guest_readiness',work_class='light',
      note=coalesce(note,'')||case when coalesce(note,'')='' then '' else E'\n' end||'Walk all seven rooms, complete the final clean, record readiness, and photograph the accepted venue state.',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'task_style','guest_readiness_round','structured_result_required',true,'initial_guest_readiness_acceptance',true,'photograph_accepted_state',true,
        'venue_zone_id',v_zone.id,'venue_zone_label',v_zone.label,'display_action','Accept + photograph','display_subject','Elm venue rooms',
        'display_detail','Entry · Bathroom · Kitchen · Lounge · Library · Conference Room · Studio','collection_zone','Venue',
        'work_rhythm','Guest Readiness','time_claims_physical_condition',false
      ),updated_at=now()
    where id=v_task.id;
    select * into v_task from atlas.tasks where id=v_task.id;
  end if;

  select id into v_state_id from atlas.rhythm_state where farm_id=v_farm.id and rhythm_key='guest_readiness' and subject_kind='zone' and subject_id=v_zone.id;
  if v_state_id is null then
    insert into atlas.rhythm_state(
      organization_id,farm_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,subject_kind,subject_id,state,
      current_task_id,current_occurrence_id,effective_rule_version,visibility_scope,assigned_user_id,last_evaluated_at,state_reason,metadata
    ) values (
      v_farm.organization_id,v_farm.id,v_binding_id,v_rule_id,'guest_readiness','zone',v_zone.id,'uninitialized',
      v_task.id,v_task.planned_occurrence_id,1,'assigned_worker',v_worker.user_id,now(),
      jsonb_build_object('source','guest_readiness_enrollment','physicalCondition','unknown','waitingFor','initial_acceptance'),
      jsonb_build_object('initialAcceptanceTaskId',v_task.id,'roomCount',7,'enrollmentCreatesTransition',false,'timeClaimsPhysicalCondition',false)
    ) returning id into v_state_id;
  end if;

  if v_task.id is not null then
    update atlas.tasks set metadata=metadata||jsonb_build_object('rhythm_state_id',v_state_id,'rhythm_binding_id',v_binding_id,'rhythm_rule_id',v_rule_id,'rhythm_key','guest_readiness','clock_managed',true),updated_at=now() where id=v_task.id;
  end if;

  insert into atlas.guest_readiness_room_state(object_id,farm_id,zone_id,status,metadata)
  select go.id,v_farm.id,v_zone.id,'unassessed',jsonb_build_object('source','guest_readiness_enrollment','physicalCondition','unknown')
  from atlas.growing_objects go
  where go.farm_id=v_farm.id and go.stable_key in ('venue_entry','venue_bathroom','venue_kitchen','venue_lounge','venue_library','venue_conference_room','venue_studio')
  on conflict (object_id) do nothing;

  update atlas.zones set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'guest_readiness_clock_state_id',v_state_id,'guest_readiness_status','unassessed','guest_readiness_room_count',7,'time_claims_physical_condition',false
  ),updated_at=now() where id=v_zone.id;
end;
$$;
