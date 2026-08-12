-- Crop protection is farm state, not an optional sentence buried in a sowing task.
-- Elm owns the treatment resources, but the exact garlic-concentrate label method
-- and reapplication interval have not yet been recorded. Build the durable layer
-- now; no worker treatment task may release until that method is explicitly
-- configured from the real product label.

create table if not exists atlas.crop_protection_policies (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  stable_key text not null,
  label text not null,
  threat_key text not null,
  scope_zone_type text not null default 'growing_zone',
  assigned_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  assigned_user_id uuid,
  concentrate_resource_id uuid references atlas.resources(id) on delete restrict,
  applicator_resource_id uuid references atlas.resources(id) on delete restrict,
  method_status text not null default 'label_required' check (method_status in ('label_required','ready','retired')),
  method_label text,
  method_instructions text[] not null default '{}'::text[],
  interval_days integer check (interval_days is null or interval_days >= 1),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(farm_id,stable_key)
);

create table if not exists atlas.crop_protection_enrollments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  policy_id uuid not null references atlas.crop_protection_policies(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete cascade,
  object_id uuid references atlas.growing_objects(id) on delete set null,
  enrollment_state text not null default 'waiting_method' check (enrollment_state in ('waiting_method','waiting_green','active','retired')),
  green_confirmed_on date,
  green_observation_id uuid references atlas.crop_observations(id) on delete set null,
  last_treated_on date,
  next_due_on date,
  active_occurrence_id uuid references atlas.planned_work_occurrences(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(policy_id,crop_cycle_id)
);

create table if not exists atlas.crop_protection_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  policy_id uuid not null references atlas.crop_protection_policies(id) on delete cascade,
  enrollment_id uuid not null references atlas.crop_protection_enrollments(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete cascade,
  object_id uuid references atlas.growing_objects(id) on delete set null,
  task_id uuid references atlas.tasks(id) on delete set null,
  event_kind text not null check (event_kind in ('green_confirmed','treatment_applied','enrollment_retired','method_configured')),
  event_date date not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table atlas.crop_protection_policies enable row level security;
alter table atlas.crop_protection_enrollments enable row level security;
alter table atlas.crop_protection_events enable row level security;
revoke all on atlas.crop_protection_policies,atlas.crop_protection_enrollments,atlas.crop_protection_events from public,anon,authenticated;
grant select,insert,update,delete on atlas.crop_protection_policies,atlas.crop_protection_enrollments,atlas.crop_protection_events to service_role;

create index if not exists crop_protection_enrollments_due_idx
  on atlas.crop_protection_enrollments(farm_id,next_due_on)
  where enrollment_state='active';
create index if not exists crop_protection_events_cycle_idx
  on atlas.crop_protection_events(crop_cycle_id,event_date desc,created_at desc);

create or replace function atlas.crop_observation_confirms_green_v1(p_stage text,p_condition text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog','atlas'
as $function$
  select lower(coalesce(p_stage,'')) in (
    'emerging','germinating','sparse_germination','seedling','establishing','established',
    'vegetative','budding','flowering','fruiting','living','browsed_alive','partial_stand',
    'stressed','compromised','urgent_rescue','cut_back'
  ) or lower(coalesce(p_condition,'')) in (
    'germinated','emerging','germinating','dense_germination','mostly_well_germinated',
    'uneven_germination','sparse_germination','growing','established','living','present',
    'good','excellent','strong_dense','browsed_alive'
  )
$function$;

revoke all on function atlas.crop_observation_confirms_green_v1(text,text) from public,anon,authenticated;
grant execute on function atlas.crop_observation_confirms_green_v1(text,text) to service_role;

create or replace function atlas.plan_crop_protection_occurrence_v1(p_enrollment_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_enrollment atlas.crop_protection_enrollments%rowtype;
  v_policy atlas.crop_protection_policies%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_zone atlas.zones%rowtype;
  v_due date;
  v_occurrence_id uuid;
  v_title text;
  v_occurrence_key text;
  v_payload jsonb;
begin
  select * into v_enrollment
  from atlas.crop_protection_enrollments enrollment
  where enrollment.id=p_enrollment_id
  for update;
  if v_enrollment.id is null then raise exception 'Crop protection enrollment not found.' using errcode='P0002'; end if;

  select * into v_policy from atlas.crop_protection_policies where id=v_enrollment.policy_id;
  select * into v_cycle from atlas.crop_cycles where id=v_enrollment.crop_cycle_id;
  if v_enrollment.object_id is not null then
    select * into v_object from atlas.growing_objects where id=v_enrollment.object_id;
    if v_object.id is not null then select * into v_zone from atlas.zones where id=v_object.zone_id; end if;
  end if;

  if not v_policy.active or v_policy.method_status<>'ready' or v_policy.interval_days is null then return null; end if;
  if v_enrollment.enrollment_state<>'active' or v_cycle.lifecycle_status<>'active' then return null; end if;
  if v_policy.assigned_membership_id is null then raise exception 'Crop protection policy needs an assigned worker before release.'; end if;

  v_due:=coalesce(v_enrollment.next_due_on,v_enrollment.green_confirmed_on,current_date);
  v_title:='Apply deer protection · '||v_cycle.crop_label||case when nullif(v_cycle.variety,'') is not null then ' · '||v_cycle.variety else '' end;
  v_occurrence_key:='crop_protection:'||v_enrollment.id::text||':'||v_due::text;
  v_payload:=jsonb_build_object(
    'farm_id',v_enrollment.farm_id,
    'title',v_title,
    'task_type','crop_protection',
    'status','open',
    'priority','high',
    'due_date',v_due,
    'action_key','protect',
    'work_class','standard',
    'work_lane','rhythm',
    'commitment_kind','hard_date',
    'task_scope','farm_operation',
    'origin_kind','generated',
    'generated_from','crop_protection_policy',
    'visibility_scope','assigned_worker',
    'assigned_membership_id',v_policy.assigned_membership_id,
    'assigned_user_id',v_policy.assigned_user_id,
    'metadata',jsonb_build_object(
      'task_key',v_occurrence_key,
      'task_series_key','crop_protection:'||v_enrollment.id::text,
      'engine_instance_key',v_occurrence_key,
      'crop_protection_policy_id',v_policy.id,
      'crop_protection_enrollment_id',v_enrollment.id,
      'crop_cycle_id',v_cycle.id,
      'crop_label',v_cycle.crop_label,
      'crop_variety',v_cycle.variety,
      'display_action','Apply deer protection',
      'display_subject',coalesce(nullif(v_cycle.variety,''),v_cycle.crop_label),
      'display_location',coalesce(v_object.label,v_zone.label,'Elm Farm'),
      'execution_do','Apply the configured deer-protection treatment to the assigned crop stand.',
      'execution_place',coalesce(v_zone.label||case when v_object.id is not null then ' · '||v_object.label else '' end,v_object.label,'Elm Farm'),
      'execution_how',to_jsonb(v_policy.method_instructions),
      'worker_context','Use the configured crop-protection method exactly as written.',
      'deer_protection_relevant',true,
      'repeat_interval_days',v_policy.interval_days,
      'date_commitment','hard_date',
      'completion_independent_schedule',false,
      'recreate_on_done',false
    )
  );

  v_occurrence_id:=atlas.plan_work_occurrence_v1(
    v_enrollment.farm_id,
    'crop_protection_deer_v1',
    v_policy.stable_key,
    v_occurrence_key,
    v_title,
    'crop_protection',
    v_due,
    'crop_protection',
    v_enrollment.id,
    'time_window',
    45,
    1,
    v_payload,
    jsonb_build_object('crop_cycle_id',v_cycle.id,'object_id',v_enrollment.object_id),
    jsonb_build_object('automatic',true,'source_kind','crop_protection'),
    v_due,
    jsonb_build_object('scheduleSource','crop_state_and_last_treatment','completionIndependentSchedule',false,'dateBehavior','hard_date')
  );

  update atlas.planned_work_occurrences
  set work_lane='rhythm',commitment_kind='hard_date',effort_units=0.5,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cropProtectionEnrollmentId',v_enrollment.id),
      updated_at=now()
  where id=v_occurrence_id;

  update atlas.crop_protection_enrollments
  set active_occurrence_id=v_occurrence_id,updated_at=now()
  where id=v_enrollment.id;

  return v_occurrence_id;
end;
$function$;

revoke all on function atlas.plan_crop_protection_occurrence_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.plan_crop_protection_occurrence_v1(uuid) to service_role;

create or replace function atlas.ensure_crop_protection_enrollment_v1(p_crop_cycle_id uuid,p_observation_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_observation atlas.crop_observations%rowtype;
  v_placement record;
  v_policy record;
  v_enrollment_id uuid;
  v_green_date date;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null or v_cycle.lifecycle_status<>'active' then return null; end if;

  if p_observation_id is not null then
    select * into v_observation from atlas.crop_observations where id=p_observation_id and crop_cycle_id=v_cycle.id;
    if v_observation.id is null or not atlas.crop_observation_confirms_green_v1(v_observation.stage,v_observation.condition) then return null; end if;
    v_green_date:=v_observation.observed_at::date;
  else
    select * into v_observation
    from atlas.crop_observations observation
    where observation.crop_cycle_id=v_cycle.id
      and atlas.crop_observation_confirms_green_v1(observation.stage,observation.condition)
    order by observation.observed_at desc,observation.created_at desc
    limit 1;
    if v_observation.id is null then return null; end if;
    v_green_date:=v_observation.observed_at::date;
  end if;

  select placement.object_id,zone.zone_type into v_placement
  from atlas.crop_placements placement
  join atlas.growing_objects object on object.id=placement.object_id
  join atlas.zones zone on zone.id=object.zone_id
  where placement.crop_cycle_id=v_cycle.id
  order by placement.updated_at desc,placement.created_at desc
  limit 1;
  if v_placement.object_id is null then return null; end if;

  for v_policy in
    select policy.*
    from atlas.crop_protection_policies policy
    where policy.farm_id=v_cycle.farm_id
      and policy.active
      and policy.threat_key='deer'
      and policy.scope_zone_type=v_placement.zone_type
  loop
    insert into atlas.crop_protection_enrollments(
      farm_id,policy_id,crop_cycle_id,object_id,enrollment_state,green_confirmed_on,green_observation_id,metadata
    )
    values(
      v_cycle.farm_id,v_policy.id,v_cycle.id,v_placement.object_id,
      case when v_policy.method_status='ready' and v_policy.interval_days is not null then 'active' else 'waiting_method' end,
      v_green_date,v_observation.id,
      jsonb_build_object('source','green_crop_observation','enrolled_at',now())
    )
    on conflict(policy_id,crop_cycle_id) do update
    set object_id=excluded.object_id,
        green_confirmed_on=least(coalesce(atlas.crop_protection_enrollments.green_confirmed_on,excluded.green_confirmed_on),excluded.green_confirmed_on),
        green_observation_id=coalesce(atlas.crop_protection_enrollments.green_observation_id,excluded.green_observation_id),
        enrollment_state=case
          when atlas.crop_protection_enrollments.enrollment_state='retired' then 'retired'
          when v_policy.method_status='ready' and v_policy.interval_days is not null then 'active'
          else 'waiting_method'
        end,
        updated_at=now()
    returning id into v_enrollment_id;

    insert into atlas.crop_protection_events(farm_id,policy_id,enrollment_id,crop_cycle_id,object_id,event_kind,event_date,metadata)
    values(v_cycle.farm_id,v_policy.id,v_enrollment_id,v_cycle.id,v_placement.object_id,'green_confirmed',v_green_date,jsonb_build_object('observation_id',v_observation.id))
    on conflict do nothing;

    if v_policy.method_status='ready' and v_policy.interval_days is not null then
      perform atlas.plan_crop_protection_occurrence_v1(v_enrollment_id);
    end if;
  end loop;

  return v_enrollment_id;
end;
$function$;

revoke all on function atlas.ensure_crop_protection_enrollment_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas.ensure_crop_protection_enrollment_v1(uuid,uuid) to service_role;

create or replace function atlas.observe_crop_protection_green_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if atlas.crop_observation_confirms_green_v1(new.stage,new.condition) then
    perform atlas.ensure_crop_protection_enrollment_v1(new.crop_cycle_id,new.id);
  end if;
  return new;
end;
$function$;

revoke all on function atlas.observe_crop_protection_green_v1() from public,anon,authenticated;
grant execute on function atlas.observe_crop_protection_green_v1() to service_role;

drop trigger if exists observe_crop_protection_green_v1 on atlas.crop_observations;
create trigger observe_crop_protection_green_v1
after insert or update of stage,condition on atlas.crop_observations
for each row
execute function atlas.observe_crop_protection_green_v1();

create or replace function atlas.attach_crop_protection_task_resources_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_policy atlas.crop_protection_policies%rowtype;
begin
  if nullif(new.metadata->>'crop_protection_policy_id','') is null then return new; end if;
  select * into v_policy from atlas.crop_protection_policies where id=(new.metadata->>'crop_protection_policy_id')::uuid;
  if v_policy.id is null then return new; end if;

  insert into atlas.task_resource_requirements(farm_id,task_id,resource_id,requirement_role,requirement_source,quantity_needed,unit,status,move_role,note,metadata)
  select new.farm_id,new.id,resource_id,'required','crop_protection_policy',null,null,'needed',move_role,null,
         jsonb_build_object('policy_id',v_policy.id,'worker_required',true)
  from (values (v_policy.concentrate_resource_id,'treatment'),(v_policy.applicator_resource_id,'equipment')) req(resource_id,move_role)
  where resource_id is not null
  on conflict do nothing;

  return new;
end;
$function$;

revoke all on function atlas.attach_crop_protection_task_resources_v1() from public,anon,authenticated;
grant execute on function atlas.attach_crop_protection_task_resources_v1() to service_role;

drop trigger if exists attach_crop_protection_task_resources_v1 on atlas.tasks;
create trigger attach_crop_protection_task_resources_v1
after insert on atlas.tasks
for each row
execute function atlas.attach_crop_protection_task_resources_v1();

create or replace function atlas.record_crop_protection_completion_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_enrollment atlas.crop_protection_enrollments%rowtype;
  v_policy atlas.crop_protection_policies%rowtype;
  v_today date:=(now() at time zone 'America/Chicago')::date;
begin
  if new.status<>'done' or old.status='done' or nullif(new.metadata->>'crop_protection_enrollment_id','') is null then return new; end if;
  select * into v_enrollment from atlas.crop_protection_enrollments where id=(new.metadata->>'crop_protection_enrollment_id')::uuid for update;
  if v_enrollment.id is null or v_enrollment.enrollment_state<>'active' then return new; end if;
  select * into v_policy from atlas.crop_protection_policies where id=v_enrollment.policy_id;
  if v_policy.id is null or v_policy.interval_days is null then return new; end if;

  insert into atlas.crop_protection_events(farm_id,policy_id,enrollment_id,crop_cycle_id,object_id,task_id,event_kind,event_date,metadata)
  values(v_enrollment.farm_id,v_policy.id,v_enrollment.id,v_enrollment.crop_cycle_id,v_enrollment.object_id,new.id,'treatment_applied',v_today,jsonb_build_object('source','task_completion'));

  update atlas.crop_protection_enrollments
  set last_treated_on=v_today,
      next_due_on=v_today+v_policy.interval_days,
      active_occurrence_id=null,
      updated_at=now()
  where id=v_enrollment.id;

  perform atlas.plan_crop_protection_occurrence_v1(v_enrollment.id);
  return new;
end;
$function$;

revoke all on function atlas.record_crop_protection_completion_v1() from public,anon,authenticated;
grant execute on function atlas.record_crop_protection_completion_v1() to service_role;

drop trigger if exists record_crop_protection_completion_v1 on atlas.tasks;
create trigger record_crop_protection_completion_v1
after update of status on atlas.tasks
for each row
when (new.status='done' and old.status is distinct from new.status)
execute function atlas.record_crop_protection_completion_v1();

create or replace function atlas.owner_configure_crop_protection_policy_v1(
  p_policy_id uuid,
  p_method_label text,
  p_method_instructions text[],
  p_interval_days integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_policy atlas.crop_protection_policies%rowtype;
  v_enrollment record;
begin
  select * into v_policy from atlas.crop_protection_policies where id=p_policy_id for update;
  if v_policy.id is null then raise exception 'Crop protection policy not found.' using errcode='P0002'; end if;
  if not atlas.is_farm_owner(v_policy.farm_id) then raise exception 'Only the farm Owner may configure a crop protection method.' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_method_label,'')),'') is null or coalesce(array_length(p_method_instructions,1),0)=0 or p_interval_days<1 then
    raise exception 'Product-label method, exact worker instructions, and reapplication interval are required.' using errcode='22023';
  end if;

  update atlas.crop_protection_policies
  set method_status='ready',method_label=btrim(p_method_label),method_instructions=p_method_instructions,
      interval_days=p_interval_days,updated_at=now(),
      metadata=metadata||jsonb_build_object('method_configured_at',now(),'method_authority','owner_confirmed_product_label')
  where id=v_policy.id;

  insert into atlas.crop_protection_events(farm_id,policy_id,enrollment_id,crop_cycle_id,object_id,event_kind,event_date,metadata)
  select enrollment.farm_id,v_policy.id,enrollment.id,enrollment.crop_cycle_id,enrollment.object_id,'method_configured',current_date,jsonb_build_object('method_label',btrim(p_method_label))
  from atlas.crop_protection_enrollments enrollment
  where enrollment.policy_id=v_policy.id and enrollment.enrollment_state<>'retired';

  update atlas.crop_protection_enrollments
  set enrollment_state='active',next_due_on=coalesce(next_due_on,green_confirmed_on,current_date),updated_at=now()
  where policy_id=v_policy.id and enrollment_state in ('waiting_method','waiting_green') and green_confirmed_on is not null;

  for v_enrollment in select id from atlas.crop_protection_enrollments where policy_id=v_policy.id and enrollment_state='active' loop
    perform atlas.plan_crop_protection_occurrence_v1(v_enrollment.id);
  end loop;

  return jsonb_build_object('policyId',v_policy.id,'state','ready','intervalDays',p_interval_days);
end;
$function$;

revoke all on function atlas.owner_configure_crop_protection_policy_v1(uuid,text,text[],integer) from public,anon,authenticated;
grant execute on function atlas.owner_configure_crop_protection_policy_v1(uuid,text,text[],integer) to authenticated;

-- Confirm only facts the Owner supplied: Elm owns garlic concentrate and a hand
-- pump sprayer. Quantity, storage location, product concentration, dilution and
-- interval remain unknown until observed or read from the label.
do $block$
declare
  v_farm_id uuid;
  v_anna_id uuid;
  v_anna_user_id uuid;
  v_concentrate_id uuid;
  v_sprayer_id uuid;
  v_policy_id uuid;
  v_cycle record;
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm';
  if v_farm_id is null then raise exception 'Elm Farm is missing.'; end if;
  select id,user_id into v_anna_id,v_anna_user_id from atlas.farm_memberships where farm_id=v_farm_id and worker_key='anna' and active=true order by created_at limit 1;
  if v_anna_id is null then raise exception 'Anna membership is missing; refusing deer-protection policy seed.'; end if;

  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,borrow_or_owner,metadata)
  values(v_farm_id,'deer_garlic_concentrate','Garlic concentrate','pest_control','deer_repellent','available',true,'elm',jsonb_build_object('source','owner_confirmation_20260811','label_method_status','not_yet_recorded'))
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,status='available',consumable=true,borrow_or_owner='elm',metadata=atlas.resources.metadata||excluded.metadata,updated_at=now()
  returning id into v_concentrate_id;

  insert into atlas.resources(farm_id,stable_key,label,resource_type,resource_category,status,consumable,borrow_or_owner,metadata)
  values(v_farm_id,'hand_pump_sprayer','Hand pump sprayer','equipment','sprayer','available',false,'elm',jsonb_build_object('source','owner_confirmation_20260811'))
  on conflict(farm_id,stable_key) do update set label=excluded.label,resource_type=excluded.resource_type,resource_category=excluded.resource_category,status='available',consumable=false,borrow_or_owner='elm',metadata=atlas.resources.metadata||excluded.metadata,updated_at=now()
  returning id into v_sprayer_id;

  insert into atlas.crop_protection_policies(
    farm_id,stable_key,label,threat_key,scope_zone_type,assigned_membership_id,assigned_user_id,
    concentrate_resource_id,applicator_resource_id,method_status,metadata
  )
  values(
    v_farm_id,'elm_deer_garlic_protection','Deer protection · green outdoor crops','deer','growing_zone',v_anna_id,v_anna_user_id,
    v_concentrate_id,v_sprayer_id,'label_required',
    jsonb_build_object(
      'source','owner_instruction_20260811',
      'first_release_rule','after_green_emergence_is_observed',
      'method_rule','Never create a worker treatment instruction until the real product-label method and interval are recorded.',
      'scope_rule','All active crop cycles placed in an Elm growing_zone after green emergence is confirmed.'
    )
  )
  on conflict(farm_id,stable_key) do update
  set assigned_membership_id=excluded.assigned_membership_id,assigned_user_id=excluded.assigned_user_id,
      concentrate_resource_id=excluded.concentrate_resource_id,applicator_resource_id=excluded.applicator_resource_id,
      metadata=atlas.crop_protection_policies.metadata||excluded.metadata,updated_at=now()
  returning id into v_policy_id;

  -- Backfill current green outdoor crops into the protection ledger. They remain
  -- waiting_method, with no worker spray task, until the label is configured.
  for v_cycle in
    select distinct cycle.id
    from atlas.crop_cycles cycle
    join atlas.crop_placements placement on placement.crop_cycle_id=cycle.id
    join atlas.growing_objects object on object.id=placement.object_id
    join atlas.zones zone on zone.id=object.zone_id
    where cycle.farm_id=v_farm_id and cycle.lifecycle_status='active' and zone.zone_type='growing_zone'
      and exists(
        select 1 from atlas.crop_observations observation
        where observation.crop_cycle_id=cycle.id
          and atlas.crop_observation_confirms_green_v1(observation.stage,observation.condition)
      )
  loop
    perform atlas.ensure_crop_protection_enrollment_v1(v_cycle.id,null);
  end loop;
end;
$block$;
