-- Govern mowing through route-level evidence and the Atlas Rhythm Clock.

create table if not exists atlas.mowing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id),
  farm_id uuid not null references atlas.farms(id),
  object_id uuid not null references atlas.growing_objects(id),
  task_id uuid references atlas.tasks(id),
  rhythm_state_id uuid references atlas.rhythm_state(id),
  outcome text not null check (outcome in ('mowed_full','mowed_partial','acceptable_no_cut','too_wet','equipment_or_area_problem','closed_not_mowable')),
  observed_at timestamptz not null default now(),
  completion_percent integer check (completion_percent is null or completion_percent between 1 and 100),
  recheck_date date,
  note text,
  idempotency_key text not null,
  created_by_user_id uuid,
  effective_membership_id uuid references atlas.farm_memberships(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id,idempotency_key)
);

create table if not exists atlas.mowing_area_state (
  object_id uuid primary key references atlas.growing_objects(id),
  organization_id uuid not null references atlas.organizations(id),
  farm_id uuid not null references atlas.farms(id),
  status text not null check (status in ('unassessed','resting','partial','acceptable','too_wet','problem','closed')),
  last_mowed_at timestamptz,
  last_observed_at timestamptz,
  source_event_id uuid references atlas.mowing_events(id),
  current_task_id uuid references atlas.tasks(id),
  current_occurrence_id uuid references atlas.planned_work_occurrences(id),
  next_check_date date,
  note text,
  equipment_group text,
  target_cut_height_inches numeric,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table atlas.mowing_events enable row level security;
alter table atlas.mowing_area_state enable row level security;

drop policy if exists mowing_events_member_read on atlas.mowing_events;
create policy mowing_events_member_read on atlas.mowing_events
for select to authenticated using (atlas.is_farm_member(farm_id));

drop policy if exists mowing_area_state_member_read on atlas.mowing_area_state;
create policy mowing_area_state_member_read on atlas.mowing_area_state
for select to authenticated using (atlas.is_farm_member(farm_id));

revoke insert,update,delete on atlas.mowing_events from anon,authenticated;
revoke insert,update,delete on atlas.mowing_area_state from anon,authenticated;
grant select on atlas.mowing_events,atlas.mowing_area_state to authenticated;

create or replace function atlas.prevent_mowing_event_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
begin
  raise exception 'Mowing evidence is append-only; record a correcting observation instead.';
end;
$$;

drop trigger if exists mowing_events_append_only_v1 on atlas.mowing_events;
create trigger mowing_events_append_only_v1
before update or delete on atlas.mowing_events
for each row execute function atlas.prevent_mowing_event_mutation_v1();

create index if not exists mowing_events_route_time_idx on atlas.mowing_events(farm_id,object_id,observed_at desc);
create index if not exists rhythm_state_mowing_idx on atlas.rhythm_state(farm_id,state,due_at) where rhythm_key='mowing';

create or replace function atlas.record_mowing_result_core_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_outcome text,
  p_completion_percent integer,
  p_recheck_date date,
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
  v_state atlas.rhythm_state%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_existing atlas.mowing_events%rowtype;
  v_event_id uuid;
  v_satisfaction_id uuid;
  v_owner_membership_id uuid;
  v_transition jsonb;
  v_clock jsonb;
  v_role text := lower(coalesce(p_effective_role,''));
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_now timestamptz := now();
  v_renewal integer;
  v_target_at timestamptz;
  v_status text;
  v_transition_id uuid;
begin
  if p_task_id is null or p_effective_membership_id is null or v_key is null or length(v_key)>160 then
    raise exception 'Task, active membership, and idempotency key are required.' using errcode='22023';
  end if;
  if p_outcome not in ('mowed_full','mowed_partial','acceptable_no_cut','too_wet','equipment_or_area_problem','closed_not_mowable') then
    raise exception 'Choose a valid mowing result.' using errcode='22023';
  end if;
  if v_note is not null and length(v_note)>3000 then raise exception 'Note must be 3000 characters or fewer.' using errcode='22023'; end if;
  if p_outcome in ('mowed_partial','equipment_or_area_problem') and v_note is null then
    raise exception 'Describe what remains or what is wrong.' using errcode='22023';
  end if;
  if p_outcome='mowed_partial' and (p_completion_percent is null or p_completion_percent<1 or p_completion_percent>99) then
    raise exception 'Partial mowing requires a completion percent from 1 to 99.' using errcode='22023';
  end if;
  if p_outcome in ('acceptable_no_cut','too_wet') and (p_recheck_date is null or p_recheck_date <= (v_now at time zone 'America/Chicago')::date) then
    raise exception 'Choose a future recheck date.' using errcode='22023';
  end if;
  if p_outcome='closed_not_mowable' and v_role not in ('owner','manager') then
    raise exception 'Only an Owner or manager may close a mowing route.' using errcode='42501';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Mowing task was not found.' using errcode='P0002'; end if;
  if v_task.status not in ('open','blocked') or v_task.task_type<>'mowing'
     or coalesce(v_task.metadata->>'task_style','')<>'mowing_round' then
    raise exception 'This task is not an open Clock-governed mowing route.' using errcode='22023';
  end if;

  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id and active;
  if v_membership.id is null or v_membership.farm_id<>v_task.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if not p_operator_mode and (auth.uid() is null or v_membership.user_id<>auth.uid()) then
    raise exception 'This membership does not belong to the signed-in player.' using errcode='42501';
  end if;
  if v_role not in ('owner','manager') and not (v_role='farm_hand' and v_task.visibility_scope='assigned_worker' and v_task.assigned_membership_id=v_membership.id) then
    raise exception 'This mowing route is outside the active player context.' using errcode='42501';
  end if;

  select rs.* into v_state
  from atlas.rhythm_state rs
  where rs.id=atlas.rhythm_safe_uuid_v1(v_task.metadata->>'rhythm_state_id')
    and rs.farm_id=v_task.farm_id and rs.rhythm_key='mowing'
  for update;
  if v_state.id is null then raise exception 'Mowing Clock state was not found.' using errcode='P0002'; end if;
  select * into v_rule from atlas.rhythm_rules where id=v_state.rhythm_rule_id;
  select * into v_object from atlas.growing_objects where id=v_state.subject_id and farm_id=v_task.farm_id;
  if v_object.id is null then raise exception 'Mowing route was not found.' using errcode='P0002'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_task.farm_id::text||':mowing:'||v_key,0));
  select * into v_existing from atlas.mowing_events where farm_id=v_task.farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    return jsonb_build_object('eventId',v_existing.id,'taskId',v_existing.task_id,'outcome',v_existing.outcome,'deduplicated',true);
  end if;

  insert into atlas.mowing_events(
    organization_id,farm_id,object_id,task_id,rhythm_state_id,outcome,observed_at,
    completion_percent,recheck_date,note,idempotency_key,created_by_user_id,effective_membership_id,metadata
  ) values(
    v_state.organization_id,v_task.farm_id,v_object.id,v_task.id,v_state.id,p_outcome,v_now,
    case when p_outcome='mowed_full' then 100 else p_completion_percent end,p_recheck_date,v_note,v_key,auth.uid(),v_membership.id,
    jsonb_build_object('operatorMode',coalesce(p_operator_mode,false),'timeClaimsPhysicalCondition',false)
  ) returning id into v_event_id;

  v_status := case p_outcome
    when 'mowed_full' then 'resting'
    when 'mowed_partial' then 'partial'
    when 'acceptable_no_cut' then 'acceptable'
    when 'too_wet' then 'too_wet'
    when 'equipment_or_area_problem' then 'problem'
    else 'closed' end;

  insert into atlas.mowing_area_state(
    object_id,organization_id,farm_id,status,last_mowed_at,last_observed_at,source_event_id,
    current_task_id,current_occurrence_id,next_check_date,note,equipment_group,target_cut_height_inches,metadata
  ) values(
    v_object.id,v_state.organization_id,v_task.farm_id,v_status,
    case when p_outcome='mowed_full' then v_now else null end,v_now,v_event_id,
    case when p_outcome in ('mowed_partial','too_wet','equipment_or_area_problem') then v_task.id end,
    case when p_outcome in ('mowed_partial','too_wet','equipment_or_area_problem') then v_task.planned_occurrence_id end,
    p_recheck_date,v_note,v_object.metadata->>'equipment_group',
    case when coalesce(v_object.metadata->>'target_cut_height_inches','')~'^\d+(\.\d+)?$' then (v_object.metadata->>'target_cut_height_inches')::numeric end,
    jsonb_build_object('lastOutcome',p_outcome,'lastTaskId',v_task.id)
  ) on conflict(object_id) do update set
    status=excluded.status,
    last_mowed_at=case when p_outcome='mowed_full' then excluded.last_mowed_at else atlas.mowing_area_state.last_mowed_at end,
    last_observed_at=excluded.last_observed_at,source_event_id=excluded.source_event_id,
    current_task_id=excluded.current_task_id,current_occurrence_id=excluded.current_occurrence_id,
    next_check_date=excluded.next_check_date,note=excluded.note,equipment_group=excluded.equipment_group,
    target_cut_height_inches=excluded.target_cut_height_inches,
    metadata=atlas.mowing_area_state.metadata||excluded.metadata,updated_at=v_now;

  if p_outcome in ('mowed_full','acceptable_no_cut') then
    if p_outcome='acceptable_no_cut' then
      v_target_at := (p_recheck_date::timestamp + time '08:00') at time zone 'America/Chicago';
      v_renewal := greatest(3600,extract(epoch from (v_target_at-v_now))::integer);
    end if;
    insert into atlas.rhythm_satisfactions(
      organization_id,farm_id,rhythm_state_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,
      subject_kind,subject_id,satisfaction_key,satisfaction_kind,satisfied_at,renewal_interval_seconds,
      source_kind,source_id,source_event,source_task_id,source_object_id,policy_match,evidence,created_by_user_id
    ) values(
      v_state.organization_id,v_state.farm_id,v_state.id,v_state.rhythm_binding_id,v_state.rhythm_rule_id,'mowing',
      'growing_object',v_object.id,'mowing:'||v_event_id::text,
      case when p_outcome='mowed_full' then 'full' else 'conditional' end,v_now,v_renewal,
      'mowing_result',v_event_id,p_outcome,v_task.id,v_object.id,
      jsonb_build_object('matchKind','structured_mowing_result','ruleKey',v_rule.rule_key),
      jsonb_build_object('mowingEventId',v_event_id,'taskId',v_task.id,'objectId',v_object.id),auth.uid()
    ) returning id into v_satisfaction_id;
    update atlas.rhythm_state set last_qualifying_satisfaction_id=v_satisfaction_id,recovery_started_at=null,updated_at=v_now where id=v_state.id;
  end if;

  if p_outcome='mowed_full' then
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done','mowing:'||v_key||':done',null,v_note,null,'mowing','mowed_full',jsonb_build_object('mowing_event_id',v_event_id,'mowing_route_object_id',v_object.id),null);
    update atlas.rhythm_state set current_task_id=null,current_occurrence_id=null,updated_at=v_now where id=v_state.id;
    v_clock:=atlas.evaluate_rhythm_binding_v1(v_state.id,v_now,'mowing_full_result');
  elsif p_outcome='acceptable_no_cut' then
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'changed_plan','mowing:'||v_key||':acceptable',null,coalesce(v_note,'Observed acceptable; no cut needed.'),'Observed acceptable; no cut needed.','mowing','acceptable_no_cut',jsonb_build_object('mowing_event_id',v_event_id,'recheck_date',p_recheck_date),null);
    update atlas.rhythm_state set current_task_id=null,current_occurrence_id=null,updated_at=v_now where id=v_state.id;
    v_clock:=atlas.evaluate_rhythm_binding_v1(v_state.id,v_now,'mowing_acceptable_result');
  elsif p_outcome='mowed_partial' then
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'partial','mowing:'||v_key||':partial',null,v_note,null,'mowing','mowed_partial',jsonb_build_object('mowing_event_id',v_event_id,'completion_percent',p_completion_percent),null);
    if v_state.state<>'recovering' then
      v_transition_id:=atlas.record_rhythm_transition_v1(v_state.id,'mowing:'||v_event_id::text||':recovering','recovering',v_state.state,'recovering','partial_result',v_now,v_now,null,v_task.id,v_task.planned_occurrence_id,jsonb_build_object('mowingEventId',v_event_id,'outcome',p_outcome));
    end if;
    update atlas.rhythm_state set state='recovering',recovery_started_at=coalesce(recovery_started_at,v_now),current_task_id=v_task.id,current_occurrence_id=v_task.planned_occurrence_id,state_reason=jsonb_build_object('source','mowing_result','eventId',v_event_id,'outcome',p_outcome),updated_at=v_now where id=v_state.id;
  elsif p_outcome='too_wet' then
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'rescheduled','mowing:'||v_key||':wet',p_recheck_date,coalesce(v_note,'Ground observed too wet to mow.'),'Ground observed too wet to mow.','mowing','too_wet',jsonb_build_object('mowing_event_id',v_event_id,'recheck_date',p_recheck_date),null);
    if v_state.state<>'recovering' then
      v_transition_id:=atlas.record_rhythm_transition_v1(v_state.id,'mowing:'||v_event_id::text||':recovering','recovering',v_state.state,'recovering','partial_result',v_now,v_now,null,v_task.id,v_task.planned_occurrence_id,jsonb_build_object('mowingEventId',v_event_id,'outcome',p_outcome));
    end if;
    update atlas.rhythm_state set state='recovering',recovery_started_at=coalesce(recovery_started_at,v_now),current_task_id=v_task.id,current_occurrence_id=v_task.planned_occurrence_id,state_reason=jsonb_build_object('source','mowing_result','eventId',v_event_id,'outcome',p_outcome,'recheckDate',p_recheck_date),updated_at=v_now where id=v_state.id;
  elsif p_outcome='equipment_or_area_problem' then
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'blocked','mowing:'||v_key||':problem',null,v_note,v_note,'mowing','owner_handoff',jsonb_build_object('mowing_event_id',v_event_id),null);
    if v_role not in ('owner','manager') then
      select id into v_owner_membership_id from atlas.farm_memberships where farm_id=v_task.farm_id and role='owner' and active order by created_at limit 1;
      if v_owner_membership_id is not null then
        update atlas.tasks set assigned_membership_id=v_owner_membership_id,visibility_scope='assigned_worker',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('assignee_key','owner','mowing_owner_handoff',true,'mowing_event_id',v_event_id,'mowing_issue',v_note),updated_at=v_now where id=v_task.id;
      end if;
    end if;
    if v_state.state<>'recovering' then
      v_transition_id:=atlas.record_rhythm_transition_v1(v_state.id,'mowing:'||v_event_id::text||':recovering','recovering',v_state.state,'recovering','partial_result',v_now,v_now,null,v_task.id,v_task.planned_occurrence_id,jsonb_build_object('mowingEventId',v_event_id,'outcome',p_outcome));
    end if;
    update atlas.rhythm_state set state='recovering',recovery_started_at=coalesce(recovery_started_at,v_now),current_task_id=v_task.id,current_occurrence_id=v_task.planned_occurrence_id,state_reason=jsonb_build_object('source','mowing_result','eventId',v_event_id,'outcome',p_outcome),updated_at=v_now where id=v_state.id;
  else
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'changed_plan','mowing:'||v_key||':closed',null,coalesce(v_note,'Mowing route closed.'),'Mowing route closed.','mowing','closed',jsonb_build_object('mowing_event_id',v_event_id),null);
    update atlas.rhythm_bindings set active=false,active_until=v_now,owner_reason=coalesce(v_note,'Mowing route closed.'),updated_at=v_now where id=v_state.rhythm_binding_id;
    update atlas.rhythm_state set current_task_id=null,current_occurrence_id=null,updated_at=v_now where id=v_state.id;
    v_clock:=atlas.evaluate_rhythm_binding_v1(v_state.id,v_now,'mowing_route_closed');
  end if;

  return jsonb_build_object('eventId',v_event_id,'taskId',v_task.id,'objectId',v_object.id,'outcome',p_outcome,'taskTransition',v_transition,'clock',v_clock,'deduplicated',false);
end;
$$;

create or replace function atlas.record_mowing_result_for_member_v1(
  p_farm_id uuid,p_task_id uuid,p_outcome text,p_completion_percent integer,p_recheck_date date,p_note text,p_idempotency_key text
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
  return atlas.record_mowing_result_core_v1(p_task_id,v_membership,v_role,p_outcome,p_completion_percent,p_recheck_date,p_note,p_idempotency_key,false);
end;
$$;

create or replace function atlas.owner_operator_record_mowing_result_v1(
  p_effective_membership_id uuid,p_task_id uuid,p_outcome text,p_completion_percent integer,p_recheck_date date,p_note text,p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_mowing_result_core_v1(p_task_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_outcome,p_completion_percent,p_recheck_date,p_note,p_idempotency_key,true);
end;
$$;

create or replace function atlas.mowing_rhythm_dashboard_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare v_items jsonb;
begin
  if auth.uid() is null or not atlas.is_farm_member(p_farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'objectId',go.id,'objectKey',go.stable_key,'label',go.label,'zoneId',go.zone_id,'zoneLabel',z.label,
    'equipmentGroup',go.metadata->>'equipment_group','targetCutHeightInches',go.metadata->>'target_cut_height_inches',
    'cadenceDays',go.metadata->>'mowing_cadence_days','stateId',rs.id,'rhythmState',rs.state,
    'warningAt',rs.warning_at,'dueAt',rs.due_at,'failureAt',rs.failure_at,'currentTaskId',rs.current_task_id,
    'areaStatus',coalesce(ms.status,'unassessed'),'lastMowedAt',ms.last_mowed_at,'lastObservedAt',ms.last_observed_at,
    'nextCheckDate',ms.next_check_date,'note',ms.note,'bindingActive',rb.active
  ) order by coalesce((go.metadata->>'mowing_sort_order')::integer,999),go.label),'[]'::jsonb) into v_items
  from atlas.rhythm_state rs
  join atlas.rhythm_bindings rb on rb.id=rs.rhythm_binding_id
  join atlas.growing_objects go on go.id=rs.subject_id
  left join atlas.zones z on z.id=go.zone_id
  left join atlas.mowing_area_state ms on ms.object_id=go.id
  where rs.farm_id=p_farm_id and rs.rhythm_key='mowing' and rs.subject_kind='growing_object';
  return jsonb_build_object('contractVersion','mowing_rhythm_dashboard_v1','farmId',p_farm_id,'items',v_items);
end;
$$;

revoke all on function atlas.record_mowing_result_core_v1(uuid,uuid,text,text,integer,date,text,text,boolean) from public,anon,authenticated;
revoke all on function atlas.record_mowing_result_for_member_v1(uuid,uuid,text,integer,date,text,text) from public,anon;
revoke all on function atlas.owner_operator_record_mowing_result_v1(uuid,uuid,text,integer,date,text,text) from public,anon;
revoke all on function atlas.mowing_rhythm_dashboard_v1(uuid) from public,anon;
grant execute on function atlas.record_mowing_result_for_member_v1(uuid,uuid,text,integer,date,text,text) to authenticated;
grant execute on function atlas.owner_operator_record_mowing_result_v1(uuid,uuid,text,integer,date,text,text) to authenticated;
grant execute on function atlas.mowing_rhythm_dashboard_v1(uuid) to authenticated;
