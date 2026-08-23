create table atlas.flower_preparation_batches (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  harvest_batch_id uuid not null references atlas.flower_harvest_batches(id) on delete restrict,
  task_id uuid not null references atlas.tasks(id) on delete restrict,
  prepared_date date not null default ((now() at time zone 'America/Chicago')::date),
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  result_kind text not null,
  note text,
  idempotency_key text not null,
  created_by_user_id uuid default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_preparation_batches_idempotency_unique unique (farm_id, idempotency_key),
  constraint flower_preparation_batches_result_check check (result_kind in ('ready','no_saleable_output'))
);

comment on table atlas.flower_preparation_batches is
  'Append-only completed flower-preparation results. This records real handling/transformation after harvest; it is not a planning object.';

create table atlas.flower_preparation_inputs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  preparation_batch_id uuid not null references atlas.flower_preparation_batches(id) on delete restrict,
  harvest_observation_id uuid not null references atlas.flower_harvest_bucket_observations(id) on delete restrict,
  source_bucket_band text not null,
  source_bucket_equivalent_floor numeric(5,2) not null,
  source_lower_bound boolean not null,
  created_at timestamptz not null default now(),
  constraint flower_preparation_inputs_harvest_observation_unique unique (harvest_observation_id)
);

comment on table atlas.flower_preparation_inputs is
  'Immutable lineage from harvested physical observations into one completed preparation result. v1 consumes each coarse harvest observation as a whole rather than inventing partial-allocation precision.';

create table atlas.flower_ready_inventory_lots (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  preparation_batch_id uuid not null references atlas.flower_preparation_batches(id) on delete restrict,
  inventory_kind text not null,
  quantity numeric(10,2) not null,
  unit text not null,
  quantity_exactness text not null,
  ready_date date not null default ((now() at time zone 'America/Chicago')::date),
  idempotency_key text not null,
  created_by_user_id uuid default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_ready_inventory_lots_idempotency_unique unique (farm_id, idempotency_key),
  constraint flower_ready_inventory_lots_kind_check check (
    inventory_kind in ('conditioned_bucket','counted_stems','posy','bouquet','lobby_arrangement')
  ),
  constraint flower_ready_inventory_lots_quantity_check check (quantity > 0),
  constraint flower_ready_inventory_lots_exactness_check check (quantity_exactness in ('exact','lower_bound')),
  constraint flower_ready_inventory_lots_semantics_check check (
    (inventory_kind='conditioned_bucket' and unit='bucket_equivalent' and quantity_exactness in ('exact','lower_bound') and mod(quantity*4,1)=0) or
    (inventory_kind='counted_stems' and unit='stem' and quantity_exactness='exact' and mod(quantity,1)=0) or
    (inventory_kind='posy' and unit='posy' and quantity_exactness='exact' and mod(quantity,1)=0) or
    (inventory_kind='bouquet' and unit='bouquet' and quantity_exactness='exact' and mod(quantity,1)=0) or
    (inventory_kind='lobby_arrangement' and unit='arrangement' and quantity_exactness='exact' and mod(quantity,1)=0)
  )
);

comment on table atlas.flower_ready_inventory_lots is
  'Append-only birth record for finished saleable flower inventory created by completed preparation. Future sale/claim/fulfillment passes must consume or claim these lots without mutating their birth truth.';
comment on column atlas.flower_ready_inventory_lots.quantity_exactness is
  'exact for counted sale units; lower_bound is allowed only for conditioned bucket-equivalent output when physical reality remains intentionally coarse.';

create index flower_preparation_batches_farm_date_idx
  on atlas.flower_preparation_batches(farm_id, prepared_date desc);
create index flower_preparation_batches_harvest_batch_idx
  on atlas.flower_preparation_batches(harvest_batch_id, prepared_date desc);
create index flower_preparation_batches_task_idx
  on atlas.flower_preparation_batches(task_id);
create index flower_preparation_batches_membership_date_idx
  on atlas.flower_preparation_batches(recorded_by_membership_id, prepared_date desc);
create index flower_preparation_inputs_batch_idx
  on atlas.flower_preparation_inputs(preparation_batch_id, created_at);
create index flower_preparation_inputs_farm_idx
  on atlas.flower_preparation_inputs(farm_id, harvest_observation_id);
create index flower_ready_inventory_lots_farm_date_idx
  on atlas.flower_ready_inventory_lots(farm_id, ready_date desc);
create index flower_ready_inventory_lots_preparation_idx
  on atlas.flower_ready_inventory_lots(preparation_batch_id, created_at);

create or replace function atlas.prevent_flower_postharvest_truth_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
begin
  raise exception 'Flower preparation and Ready birth records are append-only.' using errcode='55000';
end;
$function$;

revoke all on function atlas.prevent_flower_postharvest_truth_mutation_v1() from public, anon, authenticated;
grant execute on function atlas.prevent_flower_postharvest_truth_mutation_v1() to service_role;

create trigger flower_preparation_batches_append_only_v1
before update or delete on atlas.flower_preparation_batches
for each row execute function atlas.prevent_flower_postharvest_truth_mutation_v1();

create trigger flower_preparation_inputs_append_only_v1
before update or delete on atlas.flower_preparation_inputs
for each row execute function atlas.prevent_flower_postharvest_truth_mutation_v1();

create trigger flower_ready_inventory_lots_append_only_v1
before update or delete on atlas.flower_ready_inventory_lots
for each row execute function atlas.prevent_flower_postharvest_truth_mutation_v1();

create or replace function atlas.validate_flower_preparation_input_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_preparation atlas.flower_preparation_batches%rowtype;
  v_observation atlas.flower_harvest_bucket_observations%rowtype;
begin
  select * into v_preparation from atlas.flower_preparation_batches where id=new.preparation_batch_id;
  if v_preparation.id is null or v_preparation.farm_id is distinct from new.farm_id then
    raise exception 'Preparation batch does not belong to this farm.' using errcode='22023';
  end if;

  select * into v_observation from atlas.flower_harvest_bucket_observations where id=new.harvest_observation_id;
  if v_observation.id is null or v_observation.farm_id is distinct from new.farm_id then
    raise exception 'Harvest observation does not belong to this farm.' using errcode='22023';
  end if;
  if v_observation.batch_id is distinct from v_preparation.harvest_batch_id then
    raise exception 'Preparation input is outside the source harvest batch.' using errcode='22023';
  end if;
  if new.source_bucket_band is distinct from v_observation.bucket_band
     or new.source_bucket_equivalent_floor is distinct from v_observation.bucket_equivalent_floor
     or new.source_lower_bound is distinct from (v_observation.bucket_band='more_than_one') then
    raise exception 'Preparation input must preserve the harvested physical observation exactly.' using errcode='22023';
  end if;
  return new;
end;
$function$;

revoke all on function atlas.validate_flower_preparation_input_v1() from public, anon, authenticated;
grant execute on function atlas.validate_flower_preparation_input_v1() to service_role;

create trigger flower_preparation_inputs_validate_v1
before insert on atlas.flower_preparation_inputs
for each row execute function atlas.validate_flower_preparation_input_v1();

create or replace function atlas.validate_flower_ready_inventory_lot_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_preparation atlas.flower_preparation_batches%rowtype;
begin
  select * into v_preparation from atlas.flower_preparation_batches where id=new.preparation_batch_id;
  if v_preparation.id is null or v_preparation.farm_id is distinct from new.farm_id then
    raise exception 'Ready inventory preparation does not belong to this farm.' using errcode='22023';
  end if;
  if v_preparation.result_kind<>'ready' then
    raise exception 'A no-saleable-output preparation cannot create Ready inventory.' using errcode='22023';
  end if;
  if not exists (
    select 1 from atlas.flower_preparation_inputs where preparation_batch_id=v_preparation.id
  ) then
    raise exception 'Ready inventory requires harvested preparation input.' using errcode='22023';
  end if;
  if new.ready_date < v_preparation.prepared_date then
    raise exception 'Ready inventory cannot predate its preparation.' using errcode='22023';
  end if;
  return new;
end;
$function$;

revoke all on function atlas.validate_flower_ready_inventory_lot_v1() from public, anon, authenticated;
grant execute on function atlas.validate_flower_ready_inventory_lot_v1() to service_role;

create trigger flower_ready_inventory_lots_validate_v1
before insert on atlas.flower_ready_inventory_lots
for each row execute function atlas.validate_flower_ready_inventory_lot_v1();

alter table atlas.flower_preparation_batches enable row level security;
alter table atlas.flower_preparation_inputs enable row level security;
alter table atlas.flower_ready_inventory_lots enable row level security;

create policy flower_preparation_batches_member_read_v1
on atlas.flower_preparation_batches
for select to authenticated
using (atlas.is_farm_member(farm_id));

create policy flower_preparation_inputs_member_read_v1
on atlas.flower_preparation_inputs
for select to authenticated
using (atlas.is_farm_member(farm_id));

create policy flower_ready_inventory_lots_member_read_v1
on atlas.flower_ready_inventory_lots
for select to authenticated
using (atlas.is_farm_member(farm_id));

revoke all on atlas.flower_preparation_batches from public, anon, authenticated;
revoke all on atlas.flower_preparation_inputs from public, anon, authenticated;
revoke all on atlas.flower_ready_inventory_lots from public, anon, authenticated;
grant select on atlas.flower_preparation_batches to authenticated;
grant select on atlas.flower_preparation_inputs to authenticated;
grant select on atlas.flower_ready_inventory_lots to authenticated;
grant all on atlas.flower_preparation_batches to service_role;
grant all on atlas.flower_preparation_inputs to service_role;
grant all on atlas.flower_ready_inventory_lots to service_role;

create or replace function atlas.ensure_flower_preparation_task_v1(
  p_harvest_batch_id uuid,
  p_source_observation_id uuid,
  p_assigned_membership_id uuid,
  p_due_date date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_batch atlas.flower_harvest_batches%rowtype;
  v_observation atlas.flower_harvest_bucket_observations%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_existing_task uuid;
  v_existing_occurrence uuid;
  v_occurrence uuid;
  v_released_task uuid;
  v_signal jsonb;
  v_relation jsonb;
begin
  select * into v_batch from atlas.flower_harvest_batches where id=p_harvest_batch_id;
  if v_batch.id is null then raise exception 'Flower harvest batch not found.' using errcode='P0002'; end if;

  select * into v_observation from atlas.flower_harvest_bucket_observations where id=p_source_observation_id;
  if v_observation.id is null or v_observation.batch_id is distinct from v_batch.id then
    raise exception 'Flower harvest observation is outside the preparation batch.' using errcode='22023';
  end if;

  select * into v_membership from atlas.farm_memberships where id=p_assigned_membership_id;
  if v_membership.id is null or not v_membership.active or v_membership.farm_id is distinct from v_batch.farm_id then
    raise exception 'Preparation assignee must be an active member of this farm.' using errcode='22023';
  end if;

  if not exists (
    select 1
    from atlas.flower_harvest_bucket_observations h
    where h.batch_id=v_batch.id
      and not exists (
        select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id
      )
  ) then
    return jsonb_build_object('taskId',null,'occurrenceId',null,'action','nothing_to_prepare');
  end if;

  select t.id,t.planned_occurrence_id into v_existing_task,v_existing_occurrence
  from atlas.tasks t
  where t.farm_id=v_batch.farm_id
    and t.status in ('open','blocked')
    and t.task_type='flower_preparation'
    and t.metadata->>'flower_harvest_batch_id'=v_batch.id::text
  order by t.created_at
  limit 1;

  if v_existing_task is not null then
    return jsonb_build_object('taskId',v_existing_task,'occurrenceId',v_existing_occurrence,'action','kept_current');
  end if;

  select jsonb_build_object(
    'task_crop_cycles',coalesce(jsonb_agg(distinct jsonb_build_object(
      'crop_cycle_id',h.crop_cycle_id,
      'role','prepares_harvest',
      'confidence','confirmed',
      'source','flower_preparation_v1'
    )),'[]'::jsonb)
  ) into v_relation
  from atlas.flower_harvest_bucket_observations h
  where h.batch_id=v_batch.id
    and not exists (
      select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id
    );

  v_occurrence:=atlas.plan_work_occurrence_v1(
    p_farm_id=>v_batch.farm_id,
    p_definition_key=>'flower-preparation:'||v_batch.id::text,
    p_policy_key=>'flower-preparation:'||v_batch.id::text||':one-active',
    p_occurrence_key=>'flower-preparation:'||p_source_observation_id::text,
    p_title=>'Prepare harvested flowers · '||v_batch.harvest_date::text,
    p_task_type=>'flower_preparation',
    p_due_date=>coalesce(p_due_date,v_batch.harvest_date),
    p_source_kind=>'flower_harvest_batch',
    p_source_id=>v_batch.id,
    p_gate_type=>'event',
    p_horizon_days=>0,
    p_maximum_active_instances=>1,
    p_task_payload=>jsonb_build_object(
      'task_type','flower_preparation',
      'priority','high',
      'generated_from','flower_harvest_batch',
      'generated_from_id',v_batch.id,
      'note','Prepare the harvested flowers from this batch. Strip, condition, cool, bunch, or assemble the actual saleable form. Record what is Ready only after the handling is complete. Count stems only when the sale unit itself requires a stem count.',
      'action_key','prepare',
      'work_class','postharvest',
      'task_series_key','flower-preparation:'||v_batch.id::text,
      'engine_instance_key','flower-preparation:'||p_source_observation_id::text,
      'visibility_scope','assigned_worker',
      'assigned_membership_id',p_assigned_membership_id,
      'metadata',jsonb_build_object(
        'task_style','flower_preparation',
        'structured_result_required',true,
        'flower_harvest_batch_id',v_batch.id,
        'source_harvest_observation_id',p_source_observation_id,
        'display_action','Prepare',
        'display_subject','Harvested flowers',
        'display_detail','Create Ready inventory',
        'physical_output_mode','bucket_scale',
        'time_claims_physical_condition',false
      )
    ),
    p_relation_payload=>coalesce(v_relation,'{}'::jsonb),
    p_gate_config=>jsonb_build_object('requiresHarvestOutput',true,'timeClaimsPhysicalCondition',false),
    p_not_before_date=>coalesce(p_due_date,v_batch.harvest_date),
    p_metadata=>jsonb_build_object('flowerHarvestBatchId',v_batch.id,'sourceObservationId',p_source_observation_id)
  );

  v_signal:=atlas.signal_work_occurrence_v1(
    v_occurrence,
    'harvest_output_recorded',
    jsonb_build_object('flowerHarvestBatchId',v_batch.id,'sourceObservationId',p_source_observation_id)
  );
  select released_task_id into v_released_task from atlas.planned_work_occurrences where id=v_occurrence;

  return jsonb_build_object(
    'taskId',v_released_task,
    'occurrenceId',v_occurrence,
    'action',case when v_released_task is null then 'planned_awaiting_capacity' else 'released' end,
    'release',v_signal->'release'
  );
end;
$function$;

comment on function atlas.ensure_flower_preparation_task_v1(uuid,uuid,uuid,date) is
  'Creates at most one active preparation obligation for unprepared harvested output in a flower harvest batch. Worker Day/Clock still owns placement.';

revoke all on function atlas.ensure_flower_preparation_task_v1(uuid,uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.ensure_flower_preparation_task_v1(uuid,uuid,uuid,date) to service_role;

create or replace function atlas.queue_flower_preparation_after_harvest_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_task jsonb;
begin
  v_task:=atlas.ensure_flower_preparation_task_v1(
    new.batch_id,
    new.id,
    new.recorded_by_membership_id,
    new.observed_date
  );
  return new;
end;
$function$;

revoke all on function atlas.queue_flower_preparation_after_harvest_v1() from public, anon, authenticated;
grant execute on function atlas.queue_flower_preparation_after_harvest_v1() to service_role;

create trigger flower_harvest_bucket_observations_queue_preparation_v1
after insert on atlas.flower_harvest_bucket_observations
for each row execute function atlas.queue_flower_preparation_after_harvest_v1();

create or replace function atlas.record_flower_preparation_core_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_outputs jsonb,
  p_no_saleable_output boolean,
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
  v_membership atlas.farm_memberships%rowtype;
  v_batch atlas.flower_harvest_batches%rowtype;
  v_existing atlas.flower_preparation_batches%rowtype;
  v_preparation atlas.flower_preparation_batches%rowtype;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_batch_id uuid;
  v_output jsonb;
  v_kind text;
  v_quantity numeric(10,2);
  v_lower_bound boolean;
  v_unit text;
  v_exactness text;
  v_output_index integer := 0;
  v_input_count integer := 0;
  v_ready jsonb := '[]'::jsonb;
  v_ready_row atlas.flower_ready_inventory_lots%rowtype;
  v_transition jsonb;
  v_remaining_observation_id uuid;
  v_next_task jsonb;
begin
  if v_key is null then raise exception 'Preparation idempotency key is required.' using errcode='22023'; end if;
  if p_outputs is null then p_outputs:='[]'::jsonb; end if;
  if jsonb_typeof(p_outputs)<>'array' then raise exception 'Ready outputs must be an array.' using errcode='22023'; end if;
  if coalesce(p_no_saleable_output,false) and jsonb_array_length(p_outputs)>0 then
    raise exception 'No-saleable-output cannot also create Ready inventory.' using errcode='22023';
  end if;
  if not coalesce(p_no_saleable_output,false) and jsonb_array_length(p_outputs)=0 then
    raise exception 'Record at least one Ready output or mark that nothing saleable resulted.' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Preparation task not found.' using errcode='P0002'; end if;

  select * into v_existing
  from atlas.flower_preparation_batches
  where farm_id=v_task.farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,
      'inventoryKind',r.inventory_kind,
      'quantity',r.quantity,
      'unit',r.unit,
      'quantityExactness',r.quantity_exactness,
      'readyDate',r.ready_date
    ) order by r.created_at),'[]'::jsonb)
    into v_ready
    from atlas.flower_ready_inventory_lots r
    where r.preparation_batch_id=v_existing.id;
    return jsonb_build_object(
      'preparationBatchId',v_existing.id,
      'taskId',v_existing.task_id,
      'resultKind',v_existing.result_kind,
      'readyLots',v_ready,
      'deduplicated',true
    );
  end if;

  if v_task.status not in ('open','blocked') or v_task.task_type<>'flower_preparation' then
    raise exception 'Task is not an open flower preparation.' using errcode='22023';
  end if;
  if p_effective_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot record flower preparation.' using errcode='42501';
  end if;

  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id;
  if v_membership.id is null or not v_membership.active or v_membership.farm_id is distinct from v_task.farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if p_effective_role='farm_hand' and (
    v_task.visibility_scope<>'assigned_worker'
    or v_task.assigned_membership_id is distinct from p_effective_membership_id
  ) then
    raise exception 'Preparation task is not assigned to this worker.' using errcode='42501';
  end if;

  begin
    v_batch_id := nullif(v_task.metadata->>'flower_harvest_batch_id','')::uuid;
  exception when invalid_text_representation then
    v_batch_id := null;
  end;
  if v_batch_id is null then raise exception 'Preparation task has no harvest batch.' using errcode='22023'; end if;

  select * into v_batch from atlas.flower_harvest_batches where id=v_batch_id;
  if v_batch.id is null or v_batch.farm_id is distinct from v_task.farm_id then
    raise exception 'Preparation harvest batch is outside the task farm.' using errcode='22023';
  end if;

  perform 1
  from atlas.flower_harvest_bucket_observations h
  where h.batch_id=v_batch.id
    and not exists (
      select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id
    )
  for update;

  select count(*) into v_input_count
  from atlas.flower_harvest_bucket_observations h
  where h.batch_id=v_batch.id
    and not exists (
      select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id
    );
  if v_input_count=0 then raise exception 'There is no unprepared harvest output in this batch.' using errcode='22023'; end if;

  for v_output in select value from jsonb_array_elements(p_outputs)
  loop
    if jsonb_typeof(v_output)<>'object' then raise exception 'Each Ready output must be an object.' using errcode='22023'; end if;
    v_kind:=lower(btrim(coalesce(v_output->>'kind','')));
    if v_kind not in ('conditioned_bucket','counted_stems','posy','bouquet','lobby_arrangement') then
      raise exception 'Choose a supported Ready inventory kind.' using errcode='22023';
    end if;
    begin
      v_quantity:=(v_output->>'quantity')::numeric;
    exception when others then
      raise exception 'Ready quantity must be numeric.' using errcode='22023';
    end;
    if v_quantity is null or v_quantity<=0 or v_quantity>10000 then
      raise exception 'Ready quantity must be greater than zero.' using errcode='22023';
    end if;
    v_lower_bound:=coalesce((v_output->>'lowerBound')::boolean,false);

    if v_kind='conditioned_bucket' then
      if mod(v_quantity*4,1)<>0 then raise exception 'Conditioned bucket quantity must use quarter-bucket increments.' using errcode='22023'; end if;
    else
      if mod(v_quantity,1)<>0 then raise exception 'Counted Ready units must be whole numbers.' using errcode='22023'; end if;
      if v_lower_bound then raise exception 'Only conditioned bucket output may remain a lower bound.' using errcode='22023'; end if;
    end if;
  end loop;

  insert into atlas.flower_preparation_batches(
    farm_id,harvest_batch_id,task_id,prepared_date,recorded_by_membership_id,
    result_kind,note,idempotency_key,created_by_user_id,metadata
  ) values (
    v_task.farm_id,v_batch.id,v_task.id,v_today,p_effective_membership_id,
    case when coalesce(p_no_saleable_output,false) then 'no_saleable_output' else 'ready' end,
    nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),
    jsonb_build_object(
      'operatorMode',p_operator_mode,
      'effectiveMembershipId',p_effective_membership_id,
      'inputCount',v_input_count,
      'truthBoundary','completed_preparation'
    )
  ) returning * into v_preparation;

  insert into atlas.flower_preparation_inputs(
    farm_id,preparation_batch_id,harvest_observation_id,
    source_bucket_band,source_bucket_equivalent_floor,source_lower_bound
  )
  select h.farm_id,v_preparation.id,h.id,h.bucket_band,h.bucket_equivalent_floor,(h.bucket_band='more_than_one')
  from atlas.flower_harvest_bucket_observations h
  where h.batch_id=v_batch.id
    and not exists (
      select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id
    )
  order by h.created_at;

  for v_output in select value from jsonb_array_elements(p_outputs)
  loop
    v_output_index:=v_output_index+1;
    v_kind:=lower(btrim(v_output->>'kind'));
    v_quantity:=(v_output->>'quantity')::numeric;
    v_lower_bound:=coalesce((v_output->>'lowerBound')::boolean,false);
    v_unit:=case v_kind
      when 'conditioned_bucket' then 'bucket_equivalent'
      when 'counted_stems' then 'stem'
      when 'posy' then 'posy'
      when 'bouquet' then 'bouquet'
      when 'lobby_arrangement' then 'arrangement'
    end;
    v_exactness:=case when v_lower_bound then 'lower_bound' else 'exact' end;

    insert into atlas.flower_ready_inventory_lots(
      farm_id,preparation_batch_id,inventory_kind,quantity,unit,quantity_exactness,
      ready_date,idempotency_key,created_by_user_id,metadata
    ) values (
      v_task.farm_id,v_preparation.id,v_kind,v_quantity,v_unit,v_exactness,
      v_today,v_key||':ready:'||v_output_index::text,auth.uid(),
      jsonb_build_object(
        'sourceHarvestBatchId',v_batch.id,
        'sourcePreparationBatchId',v_preparation.id,
        'truthBoundary','finished_saleable_inventory'
      )
    ) returning * into v_ready_row;

    v_ready:=v_ready||jsonb_build_array(jsonb_build_object(
      'id',v_ready_row.id,
      'inventoryKind',v_ready_row.inventory_kind,
      'quantity',v_ready_row.quantity,
      'unit',v_ready_row.unit,
      'quantityExactness',v_ready_row.quantity_exactness,
      'readyDate',v_ready_row.ready_date
    ));
  end loop;

  v_transition:=atlas.record_task_transition_v1_internal(
    v_task.id,
    'done',
    'flower-preparation:'||v_preparation.id::text,
    null,
    p_note,
    null,
    'prepare',
    'flower_preparation',
    jsonb_build_object(
      'flower_harvest_batch_id',v_batch.id,
      'flower_preparation_batch_id',v_preparation.id,
      'result_kind',v_preparation.result_kind,
      'input_count',v_input_count,
      'ready_lot_count',jsonb_array_length(v_ready)
    ),
    null
  );

  select h.id into v_remaining_observation_id
  from atlas.flower_harvest_bucket_observations h
  where h.batch_id=v_batch.id
    and not exists (
      select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id
    )
  order by h.created_at
  limit 1;

  if v_remaining_observation_id is not null then
    v_next_task:=atlas.ensure_flower_preparation_task_v1(
      v_batch.id,
      v_remaining_observation_id,
      v_batch.recorded_by_membership_id,
      v_today
    );
  end if;

  return jsonb_build_object(
    'preparationBatchId',v_preparation.id,
    'harvestBatchId',v_batch.id,
    'taskId',v_task.id,
    'resultKind',v_preparation.result_kind,
    'inputCount',v_input_count,
    'readyLots',v_ready,
    'nextPreparation',v_next_task,
    'transition',v_transition,
    'deduplicated',false
  );
end;
$function$;

comment on function atlas.record_flower_preparation_core_v1(uuid,uuid,text,jsonb,boolean,text,text,boolean) is
  'Canonical completed flower-preparation write. Consumes unprepared harvest observations once and creates Ready inventory only from explicit finished handling output.';

revoke all on function atlas.record_flower_preparation_core_v1(uuid,uuid,text,jsonb,boolean,text,text,boolean) from public, anon, authenticated;
grant execute on function atlas.record_flower_preparation_core_v1(uuid,uuid,text,jsonb,boolean,text,text,boolean) to service_role;

create or replace function atlas.record_flower_preparation_for_member_v1(
  p_farm_id uuid,
  p_task_id uuid,
  p_outputs jsonb,
  p_no_saleable_output boolean,
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
  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  return atlas.record_flower_preparation_core_v1(
    p_task_id,v_membership,v_role,p_outputs,p_no_saleable_output,p_note,p_idempotency_key,false
  );
end;
$function$;

create or replace function atlas.owner_operator_record_flower_preparation_v1(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_outputs jsonb,
  p_no_saleable_output boolean,
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
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_flower_preparation_core_v1(
    p_task_id,
    (v_context#>>'{effective,membershipId}')::uuid,
    v_context#>>'{effective,role}',
    p_outputs,p_no_saleable_output,p_note,p_idempotency_key,true
  );
end;
$function$;

revoke all on function atlas.record_flower_preparation_for_member_v1(uuid,uuid,jsonb,boolean,text,text) from public, anon;
revoke all on function atlas.owner_operator_record_flower_preparation_v1(uuid,uuid,jsonb,boolean,text,text) from public, anon;
grant execute on function atlas.record_flower_preparation_for_member_v1(uuid,uuid,jsonb,boolean,text,text) to authenticated, service_role;
grant execute on function atlas.owner_operator_record_flower_preparation_v1(uuid,uuid,jsonb,boolean,text,text) to authenticated, service_role;