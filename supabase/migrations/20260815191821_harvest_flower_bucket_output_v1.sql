-- Harvest Pass 2: canonical flower physical-output truth.
--
-- Ordinary Elm flower harvest is recorded at bucket-equivalent scale. This layer
-- records what physically came out of the field; it does not claim saleable
-- inventory, choose products, or own worker-time placement.

create table atlas.flower_harvest_batches (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  harvest_date date not null default ((now() at time zone 'America/Chicago')::date),
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  batch_key text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flower_harvest_batches_farm_key_unique unique (farm_id, batch_key)
);

comment on table atlas.flower_harvest_batches is
  'One physical flower-harvest session/date. A batch may contain several crop-cycle/task observations and is not finished inventory.';
comment on column atlas.flower_harvest_batches.batch_key is
  'Deterministic idempotent grouping key. v1 uses one batch per effective membership per harvest date.';

create index flower_harvest_batches_farm_date_idx
  on atlas.flower_harvest_batches(farm_id, harvest_date desc);
create index flower_harvest_batches_membership_date_idx
  on atlas.flower_harvest_batches(recorded_by_membership_id, harvest_date desc);

create trigger flower_harvest_batches_set_updated_at
before update on atlas.flower_harvest_batches
for each row execute function atlas.set_updated_at();

create table atlas.flower_harvest_bucket_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  batch_id uuid not null references atlas.flower_harvest_batches(id) on delete restrict,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict,
  task_id uuid not null references atlas.tasks(id) on delete restrict,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  observed_date date not null default ((now() at time zone 'America/Chicago')::date),
  bucket_band text not null,
  bucket_equivalent_floor numeric(5,2) not null,
  more_available boolean not null,
  note text,
  idempotency_key text not null,
  created_by_user_id uuid default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_harvest_bucket_observations_idempotency_unique unique (farm_id, idempotency_key),
  constraint flower_harvest_bucket_observations_band_check check (
    bucket_band in ('quarter','half','three_quarters','one','more_than_one')
  ),
  constraint flower_harvest_bucket_observations_floor_check check (
    (bucket_band='quarter' and bucket_equivalent_floor=0.25) or
    (bucket_band='half' and bucket_equivalent_floor=0.50) or
    (bucket_band='three_quarters' and bucket_equivalent_floor=0.75) or
    (bucket_band='one' and bucket_equivalent_floor=1.00) or
    (bucket_band='more_than_one' and bucket_equivalent_floor=1.00)
  )
);

comment on table atlas.flower_harvest_bucket_observations is
  'Append-only crop-specific physical flower output recorded at bucket-equivalent scale. This is harvested physical truth, not saleable inventory.';
comment on column atlas.flower_harvest_bucket_observations.bucket_equivalent_floor is
  'Conservative numeric floor for the selected bucket band. more_than_one intentionally stores 1.00 as its floor rather than inventing precision.';

create index flower_harvest_bucket_observations_farm_date_idx
  on atlas.flower_harvest_bucket_observations(farm_id, observed_date desc);
create index flower_harvest_bucket_observations_batch_idx
  on atlas.flower_harvest_bucket_observations(batch_id, created_at);
create index flower_harvest_bucket_observations_crop_date_idx
  on atlas.flower_harvest_bucket_observations(crop_cycle_id, observed_date desc);
create index flower_harvest_bucket_observations_task_idx
  on atlas.flower_harvest_bucket_observations(task_id);

create or replace function atlas.prevent_flower_harvest_bucket_observation_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
begin
  raise exception 'Flower harvest bucket observations are append-only.' using errcode='55000';
end;
$function$;

revoke all on function atlas.prevent_flower_harvest_bucket_observation_mutation_v1() from public, anon, authenticated;
grant execute on function atlas.prevent_flower_harvest_bucket_observation_mutation_v1() to service_role;

create trigger flower_harvest_bucket_observations_append_only_v1
before update or delete on atlas.flower_harvest_bucket_observations
for each row execute function atlas.prevent_flower_harvest_bucket_observation_mutation_v1();

create or replace function atlas.validate_flower_harvest_bucket_observation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_batch atlas.flower_harvest_batches%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_task atlas.tasks%rowtype;
  v_membership atlas.farm_memberships%rowtype;
begin
  select * into v_batch from atlas.flower_harvest_batches where id=new.batch_id;
  if v_batch.id is null then raise exception 'Flower harvest batch not found.' using errcode='22023'; end if;
  if v_batch.farm_id is distinct from new.farm_id
     or v_batch.harvest_date is distinct from new.observed_date
     or v_batch.recorded_by_membership_id is distinct from new.recorded_by_membership_id then
    raise exception 'Flower harvest batch does not match the observation farm, date, or membership.' using errcode='22023';
  end if;

  select * into v_cycle from atlas.crop_cycles where id=new.crop_cycle_id;
  if v_cycle.id is null or v_cycle.farm_id is distinct from new.farm_id then
    raise exception 'Flower harvest crop cycle does not belong to this farm.' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=new.task_id;
  if v_task.id is null or v_task.farm_id is distinct from new.farm_id then
    raise exception 'Flower harvest task does not belong to this farm.' using errcode='22023';
  end if;
  if not exists (
    select 1 from atlas.task_crop_cycles tcc
    where tcc.task_id=new.task_id and tcc.crop_cycle_id=new.crop_cycle_id
  ) then
    raise exception 'Flower harvest task is not linked to this crop cycle.' using errcode='22023';
  end if;

  select * into v_membership from atlas.farm_memberships where id=new.recorded_by_membership_id;
  if v_membership.id is null or not v_membership.active or v_membership.farm_id is distinct from new.farm_id then
    raise exception 'Flower harvest membership is not active on this farm.' using errcode='22023';
  end if;

  return new;
end;
$function$;

revoke all on function atlas.validate_flower_harvest_bucket_observation_v1() from public, anon, authenticated;
grant execute on function atlas.validate_flower_harvest_bucket_observation_v1() to service_role;

create trigger flower_harvest_bucket_observations_validate_v1
before insert on atlas.flower_harvest_bucket_observations
for each row execute function atlas.validate_flower_harvest_bucket_observation_v1();

alter table atlas.flower_harvest_batches enable row level security;
alter table atlas.flower_harvest_bucket_observations enable row level security;

create policy flower_harvest_batches_member_read_v1
on atlas.flower_harvest_batches
for select to authenticated
using (atlas.is_farm_member(farm_id));

create policy flower_harvest_bucket_observations_member_read_v1
on atlas.flower_harvest_bucket_observations
for select to authenticated
using (atlas.is_farm_member(farm_id));

revoke all on atlas.flower_harvest_batches from public, anon, authenticated;
revoke all on atlas.flower_harvest_bucket_observations from public, anon, authenticated;
grant select on atlas.flower_harvest_batches to authenticated;
grant select on atlas.flower_harvest_bucket_observations to authenticated;
grant all on atlas.flower_harvest_batches to service_role;
grant all on atlas.flower_harvest_bucket_observations to service_role;

create or replace function atlas.record_flower_harvest_output_core_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_bucket_band text,
  p_more_available boolean,
  p_note text,
  p_idempotency_key text,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_band text := lower(btrim(coalesce(p_bucket_band,'')));
  v_floor numeric(5,2);
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_existing atlas.flower_harvest_bucket_observations%rowtype;
  v_existing_event_id uuid;
  v_batch_id uuid;
  v_observation atlas.flower_harvest_bucket_observations%rowtype;
  v_event atlas.crop_harvest_events%rowtype;
  v_transition jsonb;
  v_enrollment jsonb;
begin
  if v_band not in ('quarter','half','three_quarters','one','more_than_one') then
    raise exception 'Choose a supported bucket amount.' using errcode='22023';
  end if;
  v_floor := case v_band
    when 'quarter' then 0.25
    when 'half' then 0.50
    when 'three_quarters' then 0.75
    when 'one' then 1.00
    when 'more_than_one' then 1.00
  end;
  if p_more_available is null then raise exception 'Record whether more remains to harvest.' using errcode='22023'; end if;
  if v_key is null then raise exception 'Flower harvest idempotency key is required.' using errcode='22023'; end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Harvest task not found.' using errcode='P0002'; end if;

  select * into v_existing
  from atlas.flower_harvest_bucket_observations
  where farm_id=v_task.farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    select id into v_existing_event_id
    from atlas.crop_harvest_events
    where farm_id=v_task.farm_id and idempotency_key=v_key;
    return jsonb_build_object(
      'observationId',v_existing.id,
      'batchId',v_existing.batch_id,
      'eventId',v_existing_event_id,
      'taskId',v_existing.task_id,
      'cropCycleId',v_existing.crop_cycle_id,
      'bucketBand',v_existing.bucket_band,
      'bucketEquivalentFloor',v_existing.bucket_equivalent_floor,
      'moreAvailable',v_existing.more_available,
      'deduplicated',true
    );
  end if;

  if v_task.status not in ('open','blocked') or v_task.task_type<>'crop_harvest' then
    raise exception 'Task is not an open crop harvest.' using errcode='22023';
  end if;
  if p_effective_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot record harvest.' using errcode='42501';
  end if;

  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id;
  if v_membership.id is null or not v_membership.active or v_membership.farm_id is distinct from v_task.farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if p_effective_role='farm_hand' and (
    v_task.visibility_scope<>'assigned_worker'
    or v_task.assigned_membership_id is distinct from p_effective_membership_id
  ) then
    raise exception 'Harvest task is not assigned to this worker.' using errcode='42501';
  end if;

  select cc.* into v_cycle
  from atlas.task_crop_cycles tcc
  join atlas.crop_cycles cc on cc.id=tcc.crop_cycle_id
  where tcc.task_id=v_task.id
  order by tcc.created_at
  limit 1;
  if v_cycle.id is null then raise exception 'Harvest task has no linked crop cycle.' using errcode='22023'; end if;
  if v_cycle.farm_id is distinct from v_task.farm_id then raise exception 'Harvest crop cycle is outside the task farm.' using errcode='22023'; end if;

  insert into atlas.flower_harvest_batches(
    farm_id, harvest_date, recorded_by_membership_id, batch_key, metadata, created_by_user_id
  ) values (
    v_task.farm_id,
    v_today,
    p_effective_membership_id,
    'flower-harvest:'||p_effective_membership_id::text||':'||v_today::text,
    jsonb_build_object('physicalOutputMode','bucket_scale','precision','coarse_physical'),
    auth.uid()
  )
  on conflict (farm_id,batch_key) do update set updated_at=now()
  returning id into v_batch_id;

  insert into atlas.flower_harvest_bucket_observations(
    farm_id,batch_id,crop_cycle_id,task_id,recorded_by_membership_id,observed_date,
    bucket_band,bucket_equivalent_floor,more_available,note,idempotency_key,created_by_user_id,metadata
  ) values (
    v_task.farm_id,v_batch_id,v_cycle.id,v_task.id,p_effective_membership_id,v_today,
    v_band,v_floor,p_more_available,nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),
    jsonb_build_object(
      'physicalOutputMode','bucket_scale',
      'precision','coarse_physical',
      'operatorMode',p_operator_mode,
      'effectiveMembershipId',p_effective_membership_id
    )
  ) returning * into v_observation;

  insert into atlas.crop_harvest_events(
    farm_id,crop_cycle_id,task_id,event_kind,outcome,observed_date,
    more_available,note,idempotency_key,created_by_user_id,metadata
  ) values (
    v_task.farm_id,v_cycle.id,v_task.id,'cut',
    case when p_more_available then 'harvested_more' else 'harvested_finished' end,
    v_today,p_more_available,nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),
    jsonb_build_object(
      'physicalOutputMode','bucket_scale',
      'precision','coarse_physical',
      'flowerHarvestBatchId',v_batch_id,
      'flowerHarvestObservationId',v_observation.id,
      'bucketBand',v_band,
      'bucketEquivalentFloor',v_floor,
      'operatorMode',p_operator_mode,
      'effectiveMembershipId',p_effective_membership_id
    )
  ) returning * into v_event;

  v_transition := atlas.record_task_transition_v1_internal(
    v_task.id,
    'done',
    'flower-harvest:'||v_observation.id::text,
    null,
    p_note,
    null,
    'harvest',
    'crop_harvest',
    jsonb_build_object(
      'crop_cycle_id',v_cycle.id,
      'crop_harvest_event_id',v_event.id,
      'flower_harvest_batch_id',v_batch_id,
      'flower_harvest_observation_id',v_observation.id,
      'bucket_band',v_band,
      'bucket_equivalent_floor',v_floor,
      'more_available',p_more_available,
      'physical_output_mode','bucket_scale'
    ),
    null
  );

  update atlas.crop_cycles
  set harvest_started_date=coalesce(harvest_started_date,v_today),
      last_harvest_date=v_today,
      cycle_state=case when p_more_available then 'harvest_watch' else 'finished_harvest' end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'last_harvest_event_id',v_event.id,
        'last_flower_harvest_batch_id',v_batch_id,
        'last_flower_harvest_observation_id',v_observation.id,
        'last_flower_harvest_bucket_band',v_band,
        'last_flower_harvest_bucket_equivalent_floor',v_floor,
        'physical_output_mode','bucket_scale',
        'more_available',p_more_available
      ),
      updated_at=now()
  where id=v_cycle.id;

  update atlas.crop_harvest_availability
  set status=case when p_more_available then 'watching' else 'finished' end,
      estimated_quantity=null,
      unit=null,
      observed_date=v_today,
      source_event_id=v_event.id,
      current_harvest_task_id=null,
      current_harvest_occurrence_id=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'lastCutEventId',v_event.id,
        'lastFlowerHarvestBatchId',v_batch_id,
        'lastFlowerHarvestObservationId',v_observation.id,
        'lastFlowerHarvestBucketBand',v_band,
        'physicalOutputMode','bucket_scale',
        'moreAvailable',p_more_available
      ),
      updated_at=now()
  where crop_cycle_id=v_cycle.id;

  if p_more_available then
    v_enrollment := atlas.enroll_harvest_watch_v1(v_cycle.id,null,v_today+1);
  else
    update atlas.rhythm_state
    set state='paused',
        state_reason=jsonb_build_object('source','flower_harvest_finished','eventId',v_event.id,'observationId',v_observation.id),
        current_task_id=null,
        current_occurrence_id=null,
        updated_at=now()
    where farm_id=v_cycle.farm_id
      and rhythm_key='harvest_watch'
      and subject_kind='crop_cycle'
      and subject_id=v_cycle.id;
  end if;

  return jsonb_build_object(
    'observationId',v_observation.id,
    'batchId',v_batch_id,
    'eventId',v_event.id,
    'taskId',v_task.id,
    'cropCycleId',v_cycle.id,
    'bucketBand',v_band,
    'bucketEquivalentFloor',v_floor,
    'moreAvailable',p_more_available,
    'nextWatch',v_enrollment,
    'transition',v_transition,
    'deduplicated',false
  );
end;
$function$;

comment on function atlas.record_flower_harvest_output_core_v1(uuid,uuid,text,text,boolean,text,text,boolean) is
  'Canonical flower harvest physical-output write. Records bucket-scale harvested truth and advances existing crop/task state without inventing stem precision or saleable inventory.';

revoke all on function atlas.record_flower_harvest_output_core_v1(uuid,uuid,text,text,boolean,text,text,boolean) from public, anon, authenticated;
grant execute on function atlas.record_flower_harvest_output_core_v1(uuid,uuid,text,text,boolean,text,text,boolean) to service_role;

create or replace function atlas.record_flower_harvest_output_for_member_v1(
  p_farm_id uuid,
  p_task_id uuid,
  p_bucket_band text,
  p_more_available boolean,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_role text;
  v_membership uuid;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  v_membership := atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  return atlas.record_flower_harvest_output_core_v1(
    p_task_id,v_membership,v_role,p_bucket_band,p_more_available,p_note,p_idempotency_key,false
  );
end;
$function$;

create or replace function atlas.owner_operator_record_flower_harvest_output_v1(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_bucket_band text,
  p_more_available boolean,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_context jsonb;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_flower_harvest_output_core_v1(
    p_task_id,
    (v_context#>>'{effective,membershipId}')::uuid,
    v_context#>>'{effective,role}',
    p_bucket_band,p_more_available,p_note,p_idempotency_key,true
  );
end;
$function$;

revoke all on function atlas.record_flower_harvest_output_for_member_v1(uuid,uuid,text,boolean,text,text) from public, anon;
revoke all on function atlas.owner_operator_record_flower_harvest_output_v1(uuid,uuid,text,boolean,text,text) from public, anon;
grant execute on function atlas.record_flower_harvest_output_for_member_v1(uuid,uuid,text,boolean,text,text) to authenticated, service_role;
grant execute on function atlas.owner_operator_record_flower_harvest_output_v1(uuid,uuid,text,boolean,text,text) to authenticated, service_role;

-- Keep the existing release membrane, but change the worker contract from
-- precision counting to physical bucket-scale output.
create or replace function atlas.ensure_crop_harvest_task_v1(
  p_crop_cycle_id uuid,
  p_source_event_id uuid,
  p_due_date date,
  p_assigned_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
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
  v_title:='Harvest — '||v_subject||' · '||coalesce(nullif(v_object.label,''),'Growing area');
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
      'note','Cut what is physically ready. Record the flower output at bucket scale and whether more remains. Do not stop to count stems unless a later product step requires a stem count.',
      'action_key','harvest',
      'work_class','crop_cycle',
      'task_series_key','crop-harvest:'||v_cycle.id::text,
      'engine_instance_key','crop-harvest:'||p_source_event_id::text,
      'visibility_scope',case when p_assigned_membership_id is null then 'management' else 'assigned_worker' end,
      'assigned_membership_id',p_assigned_membership_id,
      'metadata',jsonb_build_object(
        'crop_harvest_clock',true,
        'structured_result_required',true,
        'physical_output_mode','bucket_scale',
        'crop_cycle_id',v_cycle.id,
        'crop_cycle_key',v_cycle.crop_cycle_key,
        'availability_event_id',p_source_event_id,
        'display_action','Harvest',
        'display_subject',v_subject,
        'display_detail','Record physical output',
        'collection_zone',v_object.label,
        'time_claims_physical_condition',false
      )
    )),
    p_relation_payload=>v_relation,
    p_gate_config=>jsonb_build_object('requiresHarvestableObservation',true,'timeClaimsPhysicalCondition',false),
    p_not_before_date=>coalesce(p_due_date,(now() at time zone 'America/Chicago')::date),
    p_metadata=>jsonb_build_object('cropCycleId',v_cycle.id,'availabilityEventId',p_source_event_id,'physicalOutputMode','bucket_scale')
  );

  v_signal:=atlas.signal_work_occurrence_v1(v_occurrence,'harvestable_observed',jsonb_build_object('cropCycleId',v_cycle.id,'eventId',p_source_event_id));
  select released_task_id into v_released_task from atlas.planned_work_occurrences where id=v_occurrence;

  update atlas.crop_harvest_availability
  set current_harvest_task_id=v_released_task,
      current_harvest_occurrence_id=v_occurrence,
      updated_at=now()
  where crop_cycle_id=v_cycle.id;

  return jsonb_build_object(
    'taskId',v_released_task,
    'occurrenceId',v_occurrence,
    'action',case when v_released_task is null then 'planned_awaiting_capacity' else 'released' end,
    'release',v_signal->'release'
  );
end;
$function$;

comment on function atlas.ensure_crop_harvest_task_v1(uuid,uuid,date,uuid) is
  'Releases one lawful crop-harvest task after a harvestable observation. Worker result is bucket-scale physical output; the function does not own worker-time placement.';
