-- Enroll crop harvest observation and cut accounting in the governed Atlas Clock.

create table if not exists atlas.crop_harvest_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id),
  crop_cycle_id uuid not null references atlas.crop_cycles(id),
  task_id uuid references atlas.tasks(id),
  event_kind text not null check (event_kind in ('watch','cut')),
  outcome text not null check (outcome in (
    'not_ready','beginning','harvestable','declining','finished','problem_or_uncertain',
    'harvested_more','harvested_finished'
  )),
  observed_date date not null,
  marketable_quantity numeric,
  seconds_quantity numeric,
  discarded_quantity numeric,
  unit text,
  more_available boolean,
  next_check_date date,
  note text,
  idempotency_key text not null,
  created_by_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id,idempotency_key),
  check (marketable_quantity is null or marketable_quantity >= 0),
  check (seconds_quantity is null or seconds_quantity >= 0),
  check (discarded_quantity is null or discarded_quantity >= 0)
);

create table if not exists atlas.crop_harvest_availability (
  crop_cycle_id uuid primary key references atlas.crop_cycles(id),
  farm_id uuid not null references atlas.farms(id),
  status text not null check (status in ('watching','beginning','harvestable','declining','finished','uncertain')),
  estimated_quantity numeric,
  unit text,
  observed_date date,
  source_event_id uuid references atlas.crop_harvest_events(id),
  current_watch_task_id uuid references atlas.tasks(id),
  current_watch_occurrence_id uuid references atlas.planned_work_occurrences(id),
  current_harvest_task_id uuid references atlas.tasks(id),
  current_harvest_occurrence_id uuid references atlas.planned_work_occurrences(id),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (estimated_quantity is null or estimated_quantity >= 0)
);

alter table atlas.crop_harvest_events enable row level security;
alter table atlas.crop_harvest_availability enable row level security;

drop policy if exists crop_harvest_events_member_read on atlas.crop_harvest_events;
create policy crop_harvest_events_member_read on atlas.crop_harvest_events
for select to authenticated using (atlas.is_farm_member(farm_id));

drop policy if exists crop_harvest_availability_member_read on atlas.crop_harvest_availability;
create policy crop_harvest_availability_member_read on atlas.crop_harvest_availability
for select to authenticated using (atlas.is_farm_member(farm_id));

revoke insert,update,delete on atlas.crop_harvest_events from anon,authenticated;
revoke insert,update,delete on atlas.crop_harvest_availability from anon,authenticated;

grant select on atlas.crop_harvest_events,atlas.crop_harvest_availability to authenticated;

create or replace function atlas.prevent_crop_harvest_event_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
begin
  raise exception 'Crop harvest evidence is append-only; record a correcting event instead.';
end;
$$;

drop trigger if exists crop_harvest_events_append_only_v1 on atlas.crop_harvest_events;
create trigger crop_harvest_events_append_only_v1
before update or delete on atlas.crop_harvest_events
for each row execute function atlas.prevent_crop_harvest_event_mutation_v1();

create or replace function atlas.ensure_crop_harvest_task_v1(
  p_crop_cycle_id uuid,
  p_source_event_id uuid,
  p_due_date date,
  p_assigned_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_existing_task uuid;
  v_existing_occurrence uuid;
  v_occurrence uuid;
  v_released_task uuid;
  v_title text;
  v_subject text;
  v_relation jsonb;
  v_signal jsonb;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;
  select * into v_object from atlas.growing_objects where id=v_cycle.object_id;

  select t.id,t.planned_occurrence_id into v_existing_task,v_existing_occurrence
  from atlas.tasks t
  join atlas.task_crop_cycles tcc on tcc.task_id=t.id and tcc.crop_cycle_id=v_cycle.id
  where t.status in ('open','blocked')
    and (t.task_type='crop_harvest' or (t.action_key='harvest' and coalesce(t.metadata->>'crop_harvest_clock','false')='true'))
  order by t.created_at limit 1;

  if v_existing_task is not null then
    update atlas.crop_harvest_availability
    set current_harvest_task_id=v_existing_task,
        current_harvest_occurrence_id=v_existing_occurrence,
        updated_at=now()
    where crop_cycle_id=v_cycle.id;
    return jsonb_build_object('taskId',v_existing_task,'occurrenceId',v_existing_occurrence,'action','kept_current');
  end if;

  v_subject:=coalesce(nullif(v_cycle.variety,''),nullif(v_cycle.crop_label,''),'Crop');
  v_title:='Harvest + count — '||v_subject||' · '||coalesce(nullif(v_object.label,''),'Growing area');
  v_relation:=jsonb_build_object(
    'task_crop_cycles',jsonb_build_array(jsonb_build_object(
      'crop_cycle_id',v_cycle.id,'role','harvests','confidence','confirmed','source','harvest_watch_clock_v1'
    )),
    'task_objects',jsonb_build_array(jsonb_build_object('object_id',v_cycle.object_id,'role','harvest_source'))
  );

  v_occurrence:=atlas.plan_work_occurrence_v1(
    p_farm_id=>v_cycle.farm_id,
    p_definition_key=>'crop-harvest:'||v_cycle.id::text,
    p_policy_key=>'crop-harvest:'||v_cycle.id::text||':one-active',
    p_occurrence_key=>'crop-harvest:'||p_source_event_id::text,
    p_title=>v_title,
    p_task_type=>'crop_harvest',
    p_due_date=>coalesce(p_due_date,(now() at time zone 'America/Chicago')::date),
    p_source_kind=>'crop_harvest_event',
    p_source_id=>p_source_event_id,
    p_gate_type=>'event',
    p_horizon_days=>0,
    p_maximum_active_instances=>1,
    p_task_payload=>jsonb_strip_nulls(jsonb_build_object(
      'zone_id',v_object.zone_id,
      'task_type','crop_harvest',
      'priority','high',
      'generated_from','crop_harvest_availability',
      'generated_from_id',p_source_event_id,
      'note','Cut what is actually ready and record real marketable, second-quality, and discarded quantity. The readiness estimate is not the harvest count.',
      'action_key','harvest',
      'work_class','crop_cycle',
      'task_series_key','crop-harvest:'||v_cycle.id::text,
      'engine_instance_key','crop-harvest:'||p_source_event_id::text,
      'visibility_scope',case when p_assigned_membership_id is null then 'management' else 'assigned_worker' end,
      'assigned_membership_id',p_assigned_membership_id,
      'metadata',jsonb_build_object(
        'crop_harvest_clock',true,
        'structured_result_required',true,
        'crop_cycle_id',v_cycle.id,
        'crop_cycle_key',v_cycle.crop_cycle_key,
        'availability_event_id',p_source_event_id,
        'display_action','Harvest + count',
        'display_subject',v_subject,
        'display_detail','Record the actual cut',
        'collection_zone',v_object.label,
        'time_claims_physical_condition',false
      )
    )),
    p_relation_payload=>v_relation,
    p_gate_config=>jsonb_build_object('requiresHarvestableObservation',true,'timeClaimsPhysicalCondition',false),
    p_not_before_date=>coalesce(p_due_date,(now() at time zone 'America/Chicago')::date),
    p_metadata=>jsonb_build_object('cropCycleId',v_cycle.id,'availabilityEventId',p_source_event_id)
  );

  v_signal:=atlas.signal_work_occurrence_v1(v_occurrence,'harvestable_observed',jsonb_build_object('cropCycleId',v_cycle.id,'eventId',p_source_event_id));
  select released_task_id into v_released_task from atlas.planned_work_occurrences where id=v_occurrence;

  update atlas.crop_harvest_availability
  set current_harvest_task_id=v_released_task,
      current_harvest_occurrence_id=v_occurrence,
      updated_at=now()
  where crop_cycle_id=v_cycle.id;

  return jsonb_build_object('taskId',v_released_task,'occurrenceId',v_occurrence,'action',case when v_released_task is null then 'planned_awaiting_capacity' else 'released' end,'release',v_signal->'release');
end;
$$;

revoke all on function atlas.ensure_crop_harvest_task_v1(uuid,uuid,date,uuid) from public,anon,authenticated;

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

create or replace function atlas.enroll_harvest_watch_v1(
  p_crop_cycle_id uuid,
  p_task_id uuid default null,
  p_due_date_override date default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_binding atlas.rhythm_bindings%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_task atlas.tasks%rowtype;
  v_due_date date;
  v_due_at timestamptz;
  v_anchor_at timestamptz;
  v_state_id uuid;
  v_occurrence uuid;
  v_status text;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then return jsonb_build_object('enrolled',false,'reason','cycle_not_found'); end if;
  select * into v_object from atlas.growing_objects where id=v_cycle.object_id;
  select status into v_status from atlas.crop_harvest_availability where crop_cycle_id=v_cycle.id;

  if v_cycle.lifecycle_status<>'active'
     or coalesce(v_cycle.sown_date,v_cycle.planted_date) is null
     or v_cycle.expected_harvest_watch_start is null
     or v_cycle.cycle_state in ('planned','planned_gap_fill','planned_interplant','sown','sown_awaiting_emergence','germinating','germination_pending','failed','cleared','finished_harvest')
     or coalesce(v_object.stable_key,'') like 'grow_room_%'
     or v_status='finished' then
    update atlas.rhythm_state set state='paused',state_reason=jsonb_build_object('source','harvest_stage_exit','cycleState',v_cycle.cycle_state),updated_at=now()
    where farm_id=v_cycle.farm_id and rhythm_key='harvest_watch' and subject_kind='crop_cycle' and subject_id=v_cycle.id;
    return jsonb_build_object('enrolled',false,'reason','not_harvest_watch_eligible','cycleState',v_cycle.cycle_state);
  end if;

  select b.* into v_binding
  from atlas.rhythm_bindings b join atlas.rhythm_rules r on r.id=b.rhythm_rule_id
  where b.farm_id=v_cycle.farm_id and b.active and b.subject_kind='crop_stage' and b.subject_key=v_cycle.cycle_state
    and r.rhythm_key='harvest_watch' and r.status='active'
  order by b.priority desc,b.created_at desc limit 1;
  if v_binding.id is null then return jsonb_build_object('enrolled',false,'reason','no_active_stage_rule','cycleState',v_cycle.cycle_state); end if;
  select * into v_rule from atlas.rhythm_rules where id=v_binding.rhythm_rule_id;

  if p_task_id is not null then select * into v_task from atlas.tasks where id=p_task_id and farm_id=v_cycle.farm_id; end if;
  if v_task.id is null then
    select t.* into v_task from atlas.tasks t
    join atlas.task_crop_cycles tcc on tcc.task_id=t.id and tcc.crop_cycle_id=v_cycle.id
    where t.status in ('open','blocked') and (t.task_type='harvest_watch' or coalesce(t.metadata->>'task_style','')='harvest_watch')
    order by t.due_date nulls last,t.created_at limit 1;
  end if;

  v_due_date:=coalesce(p_due_date_override,v_task.due_date,v_cycle.expected_harvest_watch_start);
  v_due_at:=make_timestamptz(extract(year from v_due_date)::int,extract(month from v_due_date)::int,extract(day from v_due_date)::int,8,0,0,'America/Chicago');
  v_anchor_at:=v_due_at-make_interval(secs=>v_rule.validity_interval_seconds);
  v_state_id:=atlas.seed_biological_rhythm_state_v1(v_binding.id,'crop_cycle',v_cycle.id,v_anchor_at,v_task.id,v_task.planned_occurrence_id,'harvest_watch_window_open',jsonb_build_object('dueDate',v_due_date,'cycleState',v_cycle.cycle_state,'physicalConditionClaimed',false));

  if v_task.id is not null then
    update atlas.tasks set action_key='harvest_watch',work_class='crop_cycle',visibility_scope=case when v_task.assigned_membership_id is null then 'assigned_worker' else v_task.visibility_scope end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('rhythm_state_id',v_state_id,'rhythm_key','harvest_watch','clock_managed',true,'structured_result_required',true,'time_claims_physical_condition',false),updated_at=now()
    where id=v_task.id;
    update atlas.rhythm_state set current_task_id=v_task.id,current_occurrence_id=v_task.planned_occurrence_id,updated_at=now() where id=v_state_id;
  elsif v_due_date <= (now() at time zone 'America/Chicago')::date then
    perform atlas.ensure_rhythm_task_v1(v_state_id,case when v_due_date < (now() at time zone 'America/Chicago')::date then 'fallen_out_of_rhythm' else 'due' end,v_due_at);
    select current_occurrence_id into v_occurrence from atlas.rhythm_state where id=v_state_id;
  end if;

  insert into atlas.crop_harvest_availability(crop_cycle_id,farm_id,status,observed_date,current_watch_task_id,current_watch_occurrence_id,metadata)
  values(v_cycle.id,v_cycle.farm_id,'watching',null,v_task.id,coalesce(v_task.planned_occurrence_id,v_occurrence),jsonb_build_object('baselineEnrollment',true,'expectedWindowStart',v_cycle.expected_harvest_watch_start,'expectedWindowEnd',v_cycle.expected_harvest_watch_end))
  on conflict(crop_cycle_id) do update set
    current_watch_task_id=coalesce(excluded.current_watch_task_id,atlas.crop_harvest_availability.current_watch_task_id),
    current_watch_occurrence_id=coalesce(excluded.current_watch_occurrence_id,atlas.crop_harvest_availability.current_watch_occurrence_id),
    metadata=atlas.crop_harvest_availability.metadata||excluded.metadata,updated_at=now();

  return jsonb_build_object('enrolled',true,'stateId',v_state_id,'taskId',v_task.id,'occurrenceId',coalesce(v_task.planned_occurrence_id,v_occurrence),'dueDate',v_due_date);
end;
$$;

revoke all on function atlas.enroll_harvest_watch_v1(uuid,uuid,date) from public,anon,authenticated;

create or replace function atlas.sync_harvest_watch_from_cycle_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,atlas as $$
begin
  perform atlas.enroll_harvest_watch_v1(new.id,null,null);
  return new;
end; $$;

drop trigger if exists crop_cycles_sync_harvest_watch_v1 on atlas.crop_cycles;
create trigger crop_cycles_sync_harvest_watch_v1
after insert or update of lifecycle_status,sown_date,planted_date,expected_harvest_watch_start,expected_harvest_watch_end on atlas.crop_cycles
for each row execute function atlas.sync_harvest_watch_from_cycle_v1();

create or replace function atlas.sync_harvest_watch_from_task_link_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare v_task atlas.tasks%rowtype;
begin
  select * into v_task from atlas.tasks where id=new.task_id;
  if v_task.task_type='harvest_watch' or coalesce(v_task.metadata->>'task_style','')='harvest_watch' then
    perform atlas.enroll_harvest_watch_v1(new.crop_cycle_id,new.task_id,null);
  end if;
  return new;
end; $$;

drop trigger if exists task_crop_cycles_sync_harvest_watch_v1 on atlas.task_crop_cycles;
create trigger task_crop_cycles_sync_harvest_watch_v1
after insert or update of crop_cycle_id on atlas.task_crop_cycles
for each row execute function atlas.sync_harvest_watch_from_task_link_v1();

create or replace function atlas.emit_harvest_observation_v1(
  p_task_id uuid,
  p_crop_cycle_id uuid,
  p_action text,
  p_event_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare v_task atlas.tasks%rowtype; v_workflow uuid;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  insert into atlas.workflow_events(farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload)
  values(v_task.farm_id,'harvest-observation:'||p_event_id::text,'crop_cycle',p_crop_cycle_id,p_crop_cycle_id::text,'harvest_observed:'||lower(p_action),(now() at time zone 'America/Chicago')::date,
    jsonb_build_object('taskId',p_task_id,'cropHarvestEventId',p_event_id,'action',lower(p_action),'note',nullif(btrim(coalesce(p_note,'')),''),'physicalObservationRecorded',true,'timeClaimsPhysicalCondition',false))
  on conflict(farm_id,event_key) do update set payload=excluded.payload
  returning id into v_workflow;
  return v_workflow;
end;
$$;

revoke all on function atlas.emit_harvest_observation_v1(uuid,uuid,text,uuid,text) from public,anon,authenticated;

create or replace function atlas.record_harvest_watch_observation_core_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_action text,
  p_estimated_quantity numeric,
  p_unit text,
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
  v_cycle atlas.crop_cycles%rowtype;
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_event atlas.crop_harvest_events%rowtype;
  v_existing atlas.crop_harvest_events%rowtype;
  v_transition jsonb;
  v_handoff jsonb;
  v_owner_membership uuid;
  v_handoff_id uuid;
  v_issue text;
  v_workflow uuid;
  v_harvest jsonb;
begin
  if v_action not in ('not_ready','beginning','harvestable','declining','finished','problem_or_uncertain') then raise exception 'Unsupported harvest observation.' using errcode='22023'; end if;
  if v_key is null then raise exception 'Harvest observation idempotency key is required.' using errcode='22023'; end if;
  if p_estimated_quantity is not null and p_estimated_quantity<0 then raise exception 'Estimated quantity cannot be negative.' using errcode='22023'; end if;
  if p_estimated_quantity is not null and nullif(btrim(coalesce(p_unit,'')),'') is null then raise exception 'Choose a unit for the estimated quantity.' using errcode='22023'; end if;
  if v_action in ('not_ready','beginning','declining') and (p_recheck_date is null or p_recheck_date<=v_today) then raise exception 'Choose a future recheck date.' using errcode='22023'; end if;
  if v_action='problem_or_uncertain' and nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'Describe the harvest problem or uncertainty.' using errcode='22023'; end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Harvest watch task not found.' using errcode='P0002'; end if;
  if v_task.status not in ('open','blocked') then raise exception 'Harvest watch task is not open.' using errcode='22023'; end if;
  if v_task.task_type<>'harvest_watch' and coalesce(v_task.metadata->>'task_style','')<>'harvest_watch' then raise exception 'Task is not a harvest watch.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Selected account cannot record harvest observations.' using errcode='42501'; end if;
  if p_effective_role='farm_hand' and (v_task.visibility_scope<>'assigned_worker' or v_task.assigned_membership_id is distinct from p_effective_membership_id) then raise exception 'Harvest watch is not assigned to this worker.' using errcode='42501'; end if;

  select cc.* into v_cycle from atlas.task_crop_cycles tcc join atlas.crop_cycles cc on cc.id=tcc.crop_cycle_id where tcc.task_id=v_task.id order by tcc.created_at limit 1;
  if v_cycle.id is null then raise exception 'Harvest watch has no linked crop cycle.' using errcode='22023'; end if;

  select * into v_existing from atlas.crop_harvest_events where farm_id=v_task.farm_id and idempotency_key=v_key;
  if v_existing.id is not null then return jsonb_build_object('eventId',v_existing.id,'taskId',v_task.id,'action',v_existing.outcome,'deduplicated',true); end if;

  insert into atlas.crop_harvest_events(farm_id,crop_cycle_id,task_id,event_kind,outcome,observed_date,marketable_quantity,unit,next_check_date,note,idempotency_key,created_by_user_id,metadata)
  values(v_task.farm_id,v_cycle.id,v_task.id,'watch',v_action,v_today,p_estimated_quantity,nullif(btrim(coalesce(p_unit,'')),''),p_recheck_date,nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),
    jsonb_build_object('operatorMode',p_operator_mode,'effectiveMembershipId',p_effective_membership_id,'physicalObservationRecorded',true,'timeClaimsPhysicalCondition',false)) returning * into v_event;

  insert into atlas.crop_harvest_availability(crop_cycle_id,farm_id,status,estimated_quantity,unit,observed_date,source_event_id,current_watch_task_id,current_watch_occurrence_id,metadata)
  values(v_cycle.id,v_task.farm_id,case v_action when 'not_ready' then 'watching' when 'problem_or_uncertain' then 'uncertain' else v_action end,p_estimated_quantity,nullif(btrim(coalesce(p_unit,'')),''),v_today,v_event.id,v_task.id,v_task.planned_occurrence_id,jsonb_build_object('lastAction',v_action))
  on conflict(crop_cycle_id) do update set status=excluded.status,estimated_quantity=excluded.estimated_quantity,unit=excluded.unit,observed_date=excluded.observed_date,source_event_id=excluded.source_event_id,current_watch_task_id=excluded.current_watch_task_id,current_watch_occurrence_id=excluded.current_watch_occurrence_id,metadata=atlas.crop_harvest_availability.metadata||excluded.metadata,updated_at=now();

  if v_action in ('not_ready','beginning','declining') then
    update atlas.crop_cycles set cycle_state=case when v_action='declining' then 'declining' else 'harvest_watch' end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_harvest_watch_action',v_action,'last_harvest_watch_date',v_today,'next_harvest_check_date',p_recheck_date),updated_at=now()
    where id=v_cycle.id;
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'rescheduled','harvest-watch:'||v_event.id::text,p_recheck_date,p_note,case when v_action='not_ready' then 'Not ready yet.' when v_action='beginning' then 'Beginning to reach harvest stage.' else 'Crop is declining; check what remains.' end,'harvest','harvest_watch',jsonb_build_object('crop_cycle_id',v_cycle.id,'crop_harvest_event_id',v_event.id,'action',v_action),null);
  elsif v_action='harvestable' then
    update atlas.crop_cycles set cycle_state='harvestable',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('harvest_readiness_date',v_today,'harvest_readiness_event_id',v_event.id,'harvest_readiness_estimate',p_estimated_quantity,'harvest_readiness_unit',nullif(btrim(coalesce(p_unit,'')),'')),updated_at=now() where id=v_cycle.id;
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done','harvest-watch:'||v_event.id::text,null,p_note,null,'harvest','harvest_watch',jsonb_build_object('crop_cycle_id',v_cycle.id,'crop_harvest_event_id',v_event.id,'action',v_action),null);
    v_harvest:=atlas.ensure_crop_harvest_task_v1(v_cycle.id,v_event.id,v_today,v_task.assigned_membership_id);
    update atlas.rhythm_state set state='paused',state_reason=jsonb_build_object('source','harvestable_observation','eventId',v_event.id),current_task_id=null,current_occurrence_id=null,updated_at=now()
    where farm_id=v_cycle.farm_id and rhythm_key='harvest_watch' and subject_kind='crop_cycle' and subject_id=v_cycle.id;
  elsif v_action='finished' then
    update atlas.crop_cycles set cycle_state='finished_harvest',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('harvest_finished_observed_date',v_today,'harvest_finished_event_id',v_event.id),updated_at=now() where id=v_cycle.id;
    v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done','harvest-watch:'||v_event.id::text,null,p_note,null,'harvest','harvest_watch',jsonb_build_object('crop_cycle_id',v_cycle.id,'crop_harvest_event_id',v_event.id,'action',v_action),null);
    update atlas.rhythm_state set state='paused',state_reason=jsonb_build_object('source','harvest_finished_observation','eventId',v_event.id),current_task_id=null,current_occurrence_id=null,updated_at=now()
    where farm_id=v_cycle.farm_id and rhythm_key='harvest_watch' and subject_kind='crop_cycle' and subject_id=v_cycle.id;
  else
    v_issue:=btrim(p_note);
    if p_effective_role='farm_hand' and not p_operator_mode then
      v_handoff:=atlas.worker_open_task_problem_handoff_v1(v_task.id,v_issue,'harvest-watch-problem:'||v_event.id::text);
    else
      select id into v_owner_membership from atlas.farm_memberships where farm_id=v_task.farm_id and role='owner' and active order by created_at limit 1;
      v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'blocked','harvest-watch-problem:'||v_event.id::text,null,v_issue,v_issue,'harvest','owner_handoff',jsonb_build_object('crop_cycle_id',v_cycle.id,'crop_harvest_event_id',v_event.id),null);
      insert into atlas.task_problem_handoffs(farm_id,task_id,opened_by_user_id,opened_by_membership_id,owner_membership_id,original_assigned_membership_id,original_visibility_scope,original_assignee_key,issue_text,open_idempotency_key,metadata)
      values(v_task.farm_id,v_task.id,auth.uid(),p_effective_membership_id,v_owner_membership,v_task.assigned_membership_id,v_task.visibility_scope,coalesce(v_task.metadata->>'assignee_key','farm_team'),v_issue,'harvest-watch-problem:'||v_event.id::text,jsonb_build_object('operatorMode',p_operator_mode,'cropHarvestEventId',v_event.id))
      on conflict do nothing returning id into v_handoff_id;
      update atlas.tasks set assigned_membership_id=v_owner_membership,visibility_scope='assigned_worker',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('assignee_key','owner','owner_problem_handoff_open',true,'owner_problem_handoff_id',v_handoff_id,'owner_problem_handoff_issue',v_issue),updated_at=now() where id=v_task.id;
    end if;
  end if;

  v_workflow:=atlas.emit_harvest_observation_v1(v_task.id,v_cycle.id,v_action,v_event.id,p_note);
  return jsonb_build_object('eventId',v_event.id,'workflowEventId',v_workflow,'taskId',v_task.id,'cropCycleId',v_cycle.id,'action',v_action,'nextDate',p_recheck_date,'harvest',v_harvest,'handoff',v_handoff,'handoffId',v_handoff_id,'deduplicated',false);
end;
$$;

revoke all on function atlas.record_harvest_watch_observation_core_v1(uuid,uuid,text,text,numeric,text,date,text,text,boolean) from public,anon,authenticated;

create or replace function atlas.record_harvest_watch_observation_for_member_v1(
  p_farm_id uuid,p_task_id uuid,p_action text,p_estimated_quantity numeric,p_unit text,p_recheck_date date,p_note text,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas,auth as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_harvest_watch_observation_core_v1(p_task_id,v_membership,v_role,p_action,p_estimated_quantity,p_unit,p_recheck_date,p_note,p_idempotency_key,false);
end; $$;

grant execute on function atlas.record_harvest_watch_observation_for_member_v1(uuid,uuid,text,numeric,text,date,text,text) to authenticated;
revoke all on function atlas.record_harvest_watch_observation_for_member_v1(uuid,uuid,text,numeric,text,date,text,text) from anon;

create or replace function atlas.owner_operator_record_harvest_watch_observation_v1(
  p_effective_membership_id uuid,p_task_id uuid,p_action text,p_estimated_quantity numeric,p_unit text,p_recheck_date date,p_note text,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas,auth as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_harvest_watch_observation_core_v1(p_task_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_action,p_estimated_quantity,p_unit,p_recheck_date,p_note,p_idempotency_key,true);
end; $$;

grant execute on function atlas.owner_operator_record_harvest_watch_observation_v1(uuid,uuid,text,numeric,text,date,text,text) to authenticated;
revoke all on function atlas.owner_operator_record_harvest_watch_observation_v1(uuid,uuid,text,numeric,text,date,text,text) from anon;

create or replace function atlas.record_crop_harvest_cut_core_v1(
  p_task_id uuid,p_effective_membership_id uuid,p_effective_role text,p_marketable numeric,p_seconds numeric,p_discarded numeric,p_unit text,p_more_available boolean,p_note text,p_idempotency_key text,p_operator_mode boolean default false
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas,auth as $$
declare
  v_task atlas.tasks%rowtype; v_cycle atlas.crop_cycles%rowtype; v_today date:=(now() at time zone 'America/Chicago')::date;
  v_event atlas.crop_harvest_events%rowtype; v_existing atlas.crop_harvest_events%rowtype; v_transition jsonb; v_enrollment jsonb;
begin
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'Harvest idempotency key is required.' using errcode='22023'; end if;
  if p_marketable is null or p_marketable<0 or coalesce(p_seconds,0)<0 or coalesce(p_discarded,0)<0 then raise exception 'Harvest quantities must be nonnegative.' using errcode='22023'; end if;
  if p_marketable+coalesce(p_seconds,0)+coalesce(p_discarded,0)<=0 then raise exception 'Record at least one harvested or discarded unit.' using errcode='22023'; end if;
  if nullif(btrim(coalesce(p_unit,'')),'') is null or p_more_available is null then raise exception 'Unit and whether more remains are required.' using errcode='22023'; end if;
  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Harvest task not found.' using errcode='P0002'; end if;
  if v_task.status not in ('open','blocked') or v_task.task_type<>'crop_harvest' then raise exception 'Task is not an open crop harvest.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Selected account cannot record harvest.' using errcode='42501'; end if;
  if p_effective_role='farm_hand' and (v_task.visibility_scope<>'assigned_worker' or v_task.assigned_membership_id is distinct from p_effective_membership_id) then raise exception 'Harvest task is not assigned to this worker.' using errcode='42501'; end if;
  select cc.* into v_cycle from atlas.task_crop_cycles tcc join atlas.crop_cycles cc on cc.id=tcc.crop_cycle_id where tcc.task_id=v_task.id order by tcc.created_at limit 1;
  if v_cycle.id is null then raise exception 'Harvest task has no linked crop cycle.' using errcode='22023'; end if;
  select * into v_existing from atlas.crop_harvest_events where farm_id=v_task.farm_id and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then return jsonb_build_object('eventId',v_existing.id,'taskId',v_task.id,'deduplicated',true); end if;

  insert into atlas.crop_harvest_events(farm_id,crop_cycle_id,task_id,event_kind,outcome,observed_date,marketable_quantity,seconds_quantity,discarded_quantity,unit,more_available,note,idempotency_key,created_by_user_id,metadata)
  values(v_task.farm_id,v_cycle.id,v_task.id,'cut',case when p_more_available then 'harvested_more' else 'harvested_finished' end,v_today,p_marketable,coalesce(p_seconds,0),coalesce(p_discarded,0),btrim(p_unit),p_more_available,nullif(btrim(coalesce(p_note,'')),''),p_idempotency_key,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'effectiveMembershipId',p_effective_membership_id)) returning * into v_event;

  v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done','crop-harvest:'||v_event.id::text,null,p_note,null,'harvest','crop_harvest',jsonb_build_object('crop_cycle_id',v_cycle.id,'crop_harvest_event_id',v_event.id,'marketable_quantity',p_marketable,'seconds_quantity',coalesce(p_seconds,0),'discarded_quantity',coalesce(p_discarded,0),'unit',btrim(p_unit),'more_available',p_more_available),null);
  update atlas.crop_cycles set harvest_started_date=coalesce(harvest_started_date,v_today),last_harvest_date=v_today,
    cycle_state=case when p_more_available then 'harvest_watch' else 'finished_harvest' end,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_harvest_event_id',v_event.id,'last_harvest_marketable_quantity',p_marketable,'last_harvest_seconds_quantity',coalesce(p_seconds,0),'last_harvest_discarded_quantity',coalesce(p_discarded,0),'last_harvest_unit',btrim(p_unit),'more_available',p_more_available),updated_at=now()
  where id=v_cycle.id;

  update atlas.crop_harvest_availability set status=case when p_more_available then 'watching' else 'finished' end,estimated_quantity=null,unit=btrim(p_unit),observed_date=v_today,source_event_id=v_event.id,current_harvest_task_id=null,current_harvest_occurrence_id=null,metadata=metadata||jsonb_build_object('lastCutEventId',v_event.id,'moreAvailable',p_more_available),updated_at=now() where crop_cycle_id=v_cycle.id;

  if p_more_available then
    v_enrollment:=atlas.enroll_harvest_watch_v1(v_cycle.id,null,v_today+1);
  else
    update atlas.rhythm_state set state='paused',state_reason=jsonb_build_object('source','harvest_finished_cut','eventId',v_event.id),current_task_id=null,current_occurrence_id=null,updated_at=now()
    where farm_id=v_cycle.farm_id and rhythm_key='harvest_watch' and subject_kind='crop_cycle' and subject_id=v_cycle.id;
  end if;
  return jsonb_build_object('eventId',v_event.id,'taskId',v_task.id,'cropCycleId',v_cycle.id,'marketableQuantity',p_marketable,'secondsQuantity',coalesce(p_seconds,0),'discardedQuantity',coalesce(p_discarded,0),'unit',btrim(p_unit),'moreAvailable',p_more_available,'nextWatch',v_enrollment,'deduplicated',false);
end; $$;

revoke all on function atlas.record_crop_harvest_cut_core_v1(uuid,uuid,text,numeric,numeric,numeric,text,boolean,text,text,boolean) from public,anon,authenticated;

create or replace function atlas.record_crop_harvest_cut_for_member_v1(p_farm_id uuid,p_task_id uuid,p_marketable numeric,p_seconds numeric,p_discarded numeric,p_unit text,p_more_available boolean,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas,auth as $$
declare v_role text;v_membership uuid;
begin v_role:=atlas.current_farm_role(p_farm_id);v_membership:=atlas.current_membership_id(p_farm_id);if auth.uid() is null or v_role is null then raise exception 'Active farm membership required.' using errcode='42501';end if;return atlas.record_crop_harvest_cut_core_v1(p_task_id,v_membership,v_role,p_marketable,p_seconds,p_discarded,p_unit,p_more_available,p_note,p_idempotency_key,false);end; $$;

grant execute on function atlas.record_crop_harvest_cut_for_member_v1(uuid,uuid,numeric,numeric,numeric,text,boolean,text,text) to authenticated;
revoke all on function atlas.record_crop_harvest_cut_for_member_v1(uuid,uuid,numeric,numeric,numeric,text,boolean,text,text) from anon;

create or replace function atlas.owner_operator_record_crop_harvest_cut_v1(p_effective_membership_id uuid,p_task_id uuid,p_marketable numeric,p_seconds numeric,p_discarded numeric,p_unit text,p_more_available boolean,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas,auth as $$
declare v_context jsonb;
begin v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);return atlas.record_crop_harvest_cut_core_v1(p_task_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_marketable,p_seconds,p_discarded,p_unit,p_more_available,p_note,p_idempotency_key,true);end; $$;

grant execute on function atlas.owner_operator_record_crop_harvest_cut_v1(uuid,uuid,numeric,numeric,numeric,text,boolean,text,text) to authenticated;
revoke all on function atlas.owner_operator_record_crop_harvest_cut_v1(uuid,uuid,numeric,numeric,numeric,text,boolean,text,text) from anon;

create or replace function atlas.sync_completed_crop_cycle_milestone_v1()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.status='done' and new.generated_from='crop_cycle_milestone' and new.generated_from_id is not null then
    if new.action_key='germination_check' then
      update atlas.crop_cycles set germination_checked_date=coalesce(germination_checked_date,new.due_date,current_date),cycle_state=case when cycle_state in ('sown','germinating','germination_check','sown_awaiting_emergence') then 'germinated' else cycle_state end,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('germination_result','germinated','germination_recorded_from','completed_milestone_task','germination_task_id',new.id,'germination_recorded_at',coalesce(new.completed_at,now())),updated_at=now() where id=new.generated_from_id;
    elsif new.action_key='harvest_watch' and coalesce((new.metadata->>'clock_managed')::boolean,false)=false then
      update atlas.crop_cycles set harvest_started_date=coalesce(harvest_started_date,new.due_date,current_date),updated_at=now() where id=new.generated_from_id;
    elsif new.action_key='clear_bed' then
      update atlas.crop_cycles set cleared_date=coalesce(cleared_date,new.due_date,current_date),lifecycle_status='closed',updated_at=now() where id=new.generated_from_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function atlas.biological_rhythm_dashboard_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,atlas
as $$
declare v_items jsonb;
begin
  if auth.uid() is null or not atlas.is_farm_owner(p_farm_id) then raise exception 'Only a farm Owner may read biological rhythm controls.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'stateId',rs.id,'bindingId',rs.rhythm_binding_id,'ruleId',rr.id,'rhythmKey',rs.rhythm_key,'ruleKey',rr.rule_key,'ruleLabel',rr.label,'ruleVersion',rr.version,
    'subjectKind',rs.subject_kind,'subjectId',rs.subject_id,
    'subjectLabel',case when rs.subject_kind='growing_object' then (select label from atlas.growing_objects where id=rs.subject_id) when rs.subject_kind='crop_cycle' then (select concat_ws(' · ',coalesce(nullif(variety,''),crop_label),(select label from atlas.growing_objects where id=object_id)) from atlas.crop_cycles where id=rs.subject_id) else rs.subject_id::text end,
    'state',rs.state,'warningAt',rs.warning_at,'dueAt',rs.due_at,'failureAt',rs.failure_at,'currentTaskId',rs.current_task_id,'bindingActive',rb.active,
    'validitySeconds',rr.validity_interval_seconds,'warningSeconds',rr.warning_window_seconds,'graceSeconds',rr.grace_window_seconds,
    'why',case when rs.rhythm_key='grow_room_care' then 'A completed Grow Room round keeps this rhythm valid. Time can open another care round, but it never claims the room is dry or healthy.' when rs.rhythm_key='germination_watch' then 'A sowing opened a germination watch. Only a recorded germination observation renews or closes it; manual rescheduling does not.' else 'A real planting and harvest window opened this watch. Time asks for an observation; only a field result may declare the crop ready, declining, or finished.' end,
    'controls',jsonb_build_object('pauseAppliesToRule',true,'canExtendState',true,'canForgiveState',true,'canReviseRule',true)
  ) order by rs.rhythm_key,rs.due_at nulls last),'[]'::jsonb) into v_items
  from atlas.rhythm_state rs join atlas.rhythm_rules rr on rr.id=rs.rhythm_rule_id join atlas.rhythm_bindings rb on rb.id=rs.rhythm_binding_id
  where rs.farm_id=p_farm_id and rs.rhythm_key in ('grow_room_care','germination_watch','harvest_watch');
  return jsonb_build_object('contractVersion','biological_rhythm_dashboard_v1','farmId',p_farm_id,'items',v_items);
end;
$$;

grant execute on function atlas.biological_rhythm_dashboard_v1(uuid) to authenticated;

update atlas.crop_cycles cc
set harvest_started_date=null,
    metadata=coalesce(cc.metadata,'{}'::jsonb)||jsonb_build_object('legacy_harvest_started_date_retracted',cc.harvest_started_date,'legacy_harvest_started_correction_at',now(),'correction_reason','A completed watch recorded podding, not an actual cut.'),
    updated_at=now()
where cc.harvest_started_date is not null and cc.last_harvest_date is null
  and exists(select 1 from atlas.tasks t where t.generated_from='crop_cycle_milestone' and t.generated_from_id=cc.id and t.action_key='harvest_watch' and t.status='done' and lower(coalesce(t.metadata->>'completion_reason','')) like '%podding%')
  and not exists(select 1 from atlas.crop_harvest_events e where e.crop_cycle_id=cc.id and e.event_kind='cut');

do $$
declare
  v_farm_id uuid;v_org_id uuid;v_anna_membership uuid;v_anna_user uuid;v_rule uuid;v_stage text;v_cycle record;v_result jsonb;v_state uuid;
begin
  select id,organization_id into v_farm_id,v_org_id from atlas.farms where stable_key='elm_farm';
  select id,user_id into v_anna_membership,v_anna_user from atlas.farm_memberships where farm_id=v_farm_id and worker_key='anna' and active order by created_at limit 1;
  if v_farm_id is null or v_org_id is null then raise exception 'Elm Farm Harvest Watch prerequisites are missing.'; end if;

  insert into atlas.rhythm_rules(organization_id,farm_id,rule_key,rhythm_key,version,label,status,applicability,validity_interval_seconds,warning_window_seconds,grace_window_seconds,qualifying_touches,failure_consequence,player_routing,activated_at,owner_reason,metadata)
  values(v_org_id,v_farm_id,'elm_harvest_observation_watch','harvest_watch',1,'Harvest observation watch','active',jsonb_build_object('subjectKind','crop_cycle','requiresActualPlanting',true,'requiresHarvestWindow',true),172800,43200,86400,
    jsonb_build_array(
      jsonb_build_object('sourceKind','crop_cycle','sourceEvent','harvest_observed:not_ready','effect','full','renewalIntervalSeconds',172800),
      jsonb_build_object('sourceKind','crop_cycle','sourceEvent','harvest_observed:beginning','effect','full','renewalIntervalSeconds',86400),
      jsonb_build_object('sourceKind','crop_cycle','sourceEvent','harvest_observed:declining','effect','full','renewalIntervalSeconds',86400),
      jsonb_build_object('sourceKind','crop_cycle','sourceEvent','harvest_observed:harvestable','effect','full'),
      jsonb_build_object('sourceKind','crop_cycle','sourceEvent','harvest_observed:finished','effect','full'),
      jsonb_build_object('sourceKind','crop_cycle','sourceEvent','harvest_observed:problem_or_uncertain','effect','partial')
    ),
    jsonb_build_object(
      'dueTask',jsonb_build_object('title','Harvest watch','taskType','harvest_watch','actionKey','harvest_watch','workClass','crop_cycle','visibilityScope','assigned_worker','assignedMembershipId',v_anna_membership,'priority','normal'),
      'failureTask',jsonb_build_object('title','Harvest watch','taskType','harvest_watch','actionKey','harvest_watch','workClass','crop_cycle','visibilityScope','assigned_worker','assignedMembershipId',v_anna_membership,'priority','high')
    ),
    jsonb_build_object('visibilityScope','assigned_worker','assignedMembershipId',v_anna_membership,'assignedUserId',v_anna_user),now(),'Owner approved crop Harvest Watch Clock enrollment',jsonb_build_object('timezoneName','America/Chicago','boundaryMode','exact_timestamp','timeClaimsPhysicalCondition',false,'domain','harvest_watch','availabilityTable','crop_harvest_availability'))
  on conflict(farm_id,rule_key,version) do update set status='active',qualifying_touches=excluded.qualifying_touches,failure_consequence=excluded.failure_consequence,player_routing=excluded.player_routing,metadata=atlas.rhythm_rules.metadata||excluded.metadata,updated_at=now()
  returning id into v_rule;

  foreach v_stage in array array['planted','established','establishing','growing','vegetative','germinated','emerging','blooming','flowering','fruiting','podding','partial_stand','sparse_germination','browsed_alive','stressed','cut_back','harvest_watch','declining'] loop
    insert into atlas.rhythm_bindings(organization_id,farm_id,rhythm_rule_id,binding_key,inheritance_layer,subject_kind,subject_key,priority,active,owner_reason,metadata)
    values(v_org_id,v_farm_id,v_rule,'elm_harvest_stage_'||v_stage,'contents_stage','crop_stage',v_stage,50,true,'Observe a real planted crop when its harvest window opens',jsonb_build_object('stage',v_stage,'domain','harvest_watch'))
    on conflict(farm_id,binding_key) do update set rhythm_rule_id=excluded.rhythm_rule_id,active=true,updated_at=now();
  end loop;

  for v_cycle in
    select cc.id,
      (select t.id from atlas.tasks t join atlas.task_crop_cycles tcc on tcc.task_id=t.id where tcc.crop_cycle_id=cc.id and t.status in ('open','blocked') and t.task_type='harvest_watch' order by t.due_date nulls last,t.created_at limit 1) task_id
    from atlas.crop_cycles cc join atlas.growing_objects go on go.id=cc.object_id
    where cc.farm_id=v_farm_id and cc.lifecycle_status='active' and coalesce(cc.sown_date,cc.planted_date) is not null and cc.expected_harvest_watch_start is not null
      and cc.cycle_state in ('planted','established','establishing','growing','vegetative','germinated','emerging','blooming','flowering','fruiting','podding','partial_stand','sparse_germination','browsed_alive','stressed','cut_back','harvest_watch','declining')
      and go.stable_key not like 'grow_room_%'
  loop
    v_result:=atlas.enroll_harvest_watch_v1(v_cycle.id,v_cycle.task_id,null);
    v_state:=atlas.rhythm_safe_uuid_v1(v_result->>'stateId');
    if v_cycle.task_id is not null then
      update atlas.tasks set assigned_membership_id=coalesce(assigned_membership_id,v_anna_membership),visibility_scope='assigned_worker',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('assignee_key','anna','clock_managed',true,'rhythm_key','harvest_watch','rhythm_state_id',v_state,'structured_result_required',true,'time_claims_physical_condition',false),updated_at=now() where id=v_cycle.task_id;
    end if;
    update atlas.work_release_policies set active=false,metadata=metadata||jsonb_build_object('retired_for_harvest_watch_clock',true,'retired_at',now()),updated_at=now()
    where work_definition_id in (select id from atlas.work_definitions where farm_id=v_farm_id and stable_key like 'auto:crop_cycle_milestone:crop_'||replace(v_cycle.id::text,'-','_')||'_harvest:%');
    update atlas.work_definitions set active=false,metadata=metadata||jsonb_build_object('retired_for_harvest_watch_clock',true,'retired_at',now()),updated_at=now()
    where farm_id=v_farm_id and stable_key like 'auto:crop_cycle_milestone:crop_'||replace(v_cycle.id::text,'-','_')||'_harvest:%';
  end loop;
end $$;

create index if not exists crop_harvest_events_cycle_date_idx on atlas.crop_harvest_events(crop_cycle_id,observed_date desc,created_at desc);
create index if not exists crop_harvest_events_farm_kind_idx on atlas.crop_harvest_events(farm_id,event_kind,outcome,observed_date desc);
create index if not exists crop_harvest_availability_farm_status_idx on atlas.crop_harvest_availability(farm_id,status,observed_date desc);
create index if not exists crop_cycles_harvest_clock_idx on atlas.crop_cycles(farm_id,cycle_state,expected_harvest_watch_start) where lifecycle_status='active' and expected_harvest_watch_start is not null;
create index if not exists rhythm_state_harvest_watch_idx on atlas.rhythm_state(farm_id,state,due_at) where rhythm_key='harvest_watch';
