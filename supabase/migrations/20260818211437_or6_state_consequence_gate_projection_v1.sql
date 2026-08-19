create table if not exists atlas.state_consequence_policies (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid null references atlas.farms(id) on delete cascade,
  stable_key text not null unique,
  subject_kind text not null,
  subject_selector jsonb not null default '{}'::jsonb,
  state_match jsonb not null default '{}'::jsonb,
  consequence_kind text not null,
  action_key text not null,
  audience text not null default 'farm_operations',
  priority integer not null default 100,
  action_spec jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table atlas.state_consequence_policies is
'State-driven continuation policy. A policy matches canonical subject state and releases a consequence without requiring a predecessor task id.';

create table if not exists atlas.state_consequence_instances (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  policy_id uuid not null references atlas.state_consequence_policies(id) on delete cascade,
  subject_kind text not null,
  subject_id uuid not null,
  consequence_key text not null,
  consequence_kind text not null,
  action_key text not null,
  audience text not null,
  priority integer not null default 100,
  status text not null default 'open' check (status in ('open','resolved')),
  release_generation integer not null default 1 check (release_generation > 0),
  state_fingerprint text not null,
  state_snapshot jsonb not null default '{}'::jsonb,
  consequence_payload jsonb not null default '{}'::jsonb,
  released_at timestamptz not null default now(),
  last_evaluated_at timestamptz not null default now(),
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(policy_id, subject_kind, subject_id)
);

comment on table atlas.state_consequence_instances is
'Current projection of consequences that fit because a canonical state predicate is true. Open/resolved is derived by reconciliation; it is not a task-completion ledger.';

create table if not exists atlas.state_consequence_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  instance_id uuid not null references atlas.state_consequence_instances(id) on delete cascade,
  policy_id uuid not null references atlas.state_consequence_policies(id) on delete cascade,
  subject_kind text not null,
  subject_id uuid not null,
  event_kind text not null check (event_kind in ('released','resolved')),
  release_generation integer not null check (release_generation > 0),
  idempotency_key text not null unique,
  state_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table atlas.state_consequence_events is
'Append-only release/resolution history for state-driven consequences.';

create index if not exists state_consequence_policies_subject_idx
  on atlas.state_consequence_policies(subject_kind, active, priority);
create index if not exists state_consequence_instances_subject_idx
  on atlas.state_consequence_instances(subject_kind, subject_id, status, priority);
create index if not exists state_consequence_instances_farm_status_idx
  on atlas.state_consequence_instances(farm_id, status, priority);
create index if not exists state_consequence_events_subject_idx
  on atlas.state_consequence_events(subject_kind, subject_id, created_at desc);

alter table atlas.state_consequence_policies enable row level security;
alter table atlas.state_consequence_instances enable row level security;
alter table atlas.state_consequence_events enable row level security;

drop policy if exists state_consequence_policies_read_operations on atlas.state_consequence_policies;
create policy state_consequence_policies_read_operations
on atlas.state_consequence_policies
for select to authenticated
using (farm_id is null or atlas.can_read_farm_operations(farm_id));

drop policy if exists state_consequence_instances_read_operations on atlas.state_consequence_instances;
create policy state_consequence_instances_read_operations
on atlas.state_consequence_instances
for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists state_consequence_events_read_operations on atlas.state_consequence_events;
create policy state_consequence_events_read_operations
on atlas.state_consequence_events
for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop trigger if exists set_state_consequence_policies_updated_at on atlas.state_consequence_policies;
create trigger set_state_consequence_policies_updated_at
before update on atlas.state_consequence_policies
for each row execute function atlas.set_updated_at();

drop trigger if exists set_state_consequence_instances_updated_at on atlas.state_consequence_instances;
create trigger set_state_consequence_instances_updated_at
before update on atlas.state_consequence_instances
for each row execute function atlas.set_updated_at();

create or replace function atlas.prevent_state_consequence_event_mutation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $$
begin
  raise exception 'state_consequence_events is append-only.' using errcode='55000';
end;
$$;

drop trigger if exists prevent_state_consequence_event_update_delete on atlas.state_consequence_events;
create trigger prevent_state_consequence_event_update_delete
before update or delete on atlas.state_consequence_events
for each row execute function atlas.prevent_state_consequence_event_mutation_v1();

create or replace function atlas.state_consequence_snapshot_v1(
  p_subject_kind text,
  p_subject_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_resource atlas.resources%rowtype;
  v_resource_state atlas.resource_operational_state%rowtype;
  v_inventory jsonb := '{}'::jsonb;
  v_quantity_governed boolean := false;
  v_seed atlas.seed_lots%rowtype;
  v_seed_position jsonb := '{}'::jsonb;
  v_future_outstanding numeric := 0;
  v_projected_on_hand numeric;
  v_count_trusted boolean := false;
  v_shortfall numeric;
  v_batch atlas.flower_harvest_batches%rowtype;
  v_observation_count integer := 0;
  v_preparation_count integer := 0;
  v_ready_lot_count integer := 0;
begin
  if p_subject_kind='resource' then
    select * into v_resource from atlas.resources where id=p_subject_id;
    if v_resource.id is null then
      return jsonb_build_object('state','subject_missing','subjectKind',p_subject_kind,'subjectId',p_subject_id);
    end if;
    select * into v_resource_state
    from atlas.resource_operational_state
    where resource_id=v_resource.id;

    v_quantity_governed := coalesce(v_resource.metadata->>'quantity_governed','false')='true';
    if v_quantity_governed then
      v_inventory := atlas.resource_inventory_position_v1(v_resource.id);
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'subjectKind','resource',
      'subjectId',v_resource.id,
      'farmId',v_resource.farm_id,
      'stableKey',v_resource.stable_key,
      'label',v_resource.label,
      'resourceType',v_resource.resource_type,
      'resourceCategory',v_resource.resource_category,
      'resourceRole',v_resource.metadata->>'resource_role',
      'quantityGoverned',v_quantity_governed,
      'readinessState',v_resource_state.readiness_state,
      'quantityState',v_resource_state.quantity_state,
      'knownQuantity',v_resource_state.known_quantity,
      'unit',coalesce(v_resource_state.unit,v_resource.unit),
      'inventoryState',case when v_quantity_governed then v_inventory->>'state' else null end,
      'inventoryPosition',case when v_quantity_governed then v_inventory else null end
    ));

  elsif p_subject_kind='seed_lot' then
    select * into v_seed from atlas.seed_lots where id=p_subject_id;
    if v_seed.id is null then
      return jsonb_build_object('state','subject_missing','subjectKind',p_subject_kind,'subjectId',p_subject_id);
    end if;

    select to_jsonb(p) into v_seed_position
    from atlas.seed_inventory_position_v1 p
    where p.seed_lot_id=v_seed.id;
    v_seed_position := coalesce(v_seed_position,'{}'::jsonb);
    v_count_trusted := coalesce((v_seed_position->>'count_trusted')::boolean,false);
    begin
      v_projected_on_hand := nullif(v_seed_position->>'projected_on_hand_quantity','')::numeric;
    exception when invalid_text_representation then
      v_projected_on_hand := null;
    end;

    select coalesce(sum(c.outstanding_quantity),0)
      into v_future_outstanding
    from atlas.seed_allocation_coverage_v1 c
    where c.seed_lot_id=v_seed.id;

    if v_count_trusted and v_projected_on_hand is not null then
      v_shortfall := greatest(v_future_outstanding-v_projected_on_hand,0);
    else
      v_shortfall := null;
    end if;

    return jsonb_strip_nulls(jsonb_build_object(
      'subjectKind','seed_lot',
      'subjectId',v_seed.id,
      'farmId',v_seed.farm_id,
      'stableKey',v_seed.stable_key,
      'label',v_seed.lot_label,
      'cropLabel',v_seed.crop_label,
      'variety',v_seed.variety,
      'inventoryStatus',v_seed_position->>'observation_status',
      'countTrusted',v_count_trusted,
      'projectedOnHandQuantity',v_projected_on_hand,
      'futureOutstandingQuantity',v_future_outstanding,
      'hasFutureCommitments',(v_future_outstanding>0),
      'trustedShortfallQuantity',v_shortfall,
      'hasTrustedShortfall',(v_count_trusted and coalesce(v_shortfall,0)>0),
      'unit',coalesce(v_seed_position->>'quantity_unit',v_seed.quantity_unit),
      'inventoryPosition',v_seed_position
    ));

  elsif p_subject_kind='flower_harvest_batch' then
    select * into v_batch from atlas.flower_harvest_batches where id=p_subject_id;
    if v_batch.id is null then
      return jsonb_build_object('state','subject_missing','subjectKind',p_subject_kind,'subjectId',p_subject_id);
    end if;

    select count(*)::integer into v_observation_count
    from atlas.flower_harvest_bucket_observations o where o.batch_id=v_batch.id;
    select count(*)::integer into v_preparation_count
    from atlas.flower_preparation_batches p where p.harvest_batch_id=v_batch.id;
    select count(*)::integer into v_ready_lot_count
    from atlas.flower_ready_inventory_lots r
    join atlas.flower_preparation_batches p on p.id=r.preparation_batch_id
    where p.harvest_batch_id=v_batch.id;

    return jsonb_strip_nulls(jsonb_build_object(
      'subjectKind','flower_harvest_batch',
      'subjectId',v_batch.id,
      'farmId',v_batch.farm_id,
      'stableKey',v_batch.batch_key,
      'label',v_batch.batch_key,
      'harvestDate',v_batch.harvest_date,
      'physicalOutputObserved',(v_observation_count>0),
      'observationCount',v_observation_count,
      'preparationState',case
        when v_observation_count=0 then 'awaiting_measurement'
        when v_preparation_count=0 then 'unprepared'
        else 'prepared'
      end,
      'preparationBatchCount',v_preparation_count,
      'readyInventoryLotCount',v_ready_lot_count,
      'readyInventoryExists',(v_ready_lot_count>0)
    ));
  end if;

  return jsonb_build_object('state','unsupported_subject_kind','subjectKind',p_subject_kind,'subjectId',p_subject_id);
end;
$$;

revoke all on function atlas.state_consequence_snapshot_v1(text,uuid) from public, anon, authenticated;
grant execute on function atlas.state_consequence_snapshot_v1(text,uuid) to service_role;

create or replace function atlas.current_state_consequences_v1(
  p_subject_kind text,
  p_subject_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'instanceId',i.id,
      'policyKey',p.stable_key,
      'consequenceKey',i.consequence_key,
      'consequenceKind',i.consequence_kind,
      'actionKey',i.action_key,
      'audience',i.audience,
      'priority',i.priority,
      'releaseGeneration',i.release_generation,
      'releasedAt',i.released_at,
      'actionSpec',p.action_spec,
      'state',i.state_snapshot,
      'payload',i.consequence_payload
    ) order by i.priority asc, i.released_at asc
  ),'[]'::jsonb)
  from atlas.state_consequence_instances i
  join atlas.state_consequence_policies p on p.id=i.policy_id
  where i.subject_kind=p_subject_kind
    and i.subject_id=p_subject_id
    and i.status='open'
    and p.active;
$$;

revoke all on function atlas.current_state_consequences_v1(text,uuid) from public, anon, authenticated;
grant execute on function atlas.current_state_consequences_v1(text,uuid) to service_role;

create or replace function atlas.reconcile_state_consequences_v1(
  p_subject_kind text,
  p_subject_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_snapshot jsonb;
  v_farm_id uuid;
  v_fingerprint text;
  v_policy atlas.state_consequence_policies%rowtype;
  v_instance atlas.state_consequence_instances%rowtype;
  v_matches boolean;
  v_generation integer;
  v_payload jsonb;
begin
  v_snapshot := atlas.state_consequence_snapshot_v1(p_subject_kind,p_subject_id);
  begin
    v_farm_id := nullif(v_snapshot->>'farmId','')::uuid;
  exception when invalid_text_representation then
    v_farm_id := null;
  end;

  if v_farm_id is null then
    for v_instance in
      select i.*
      from atlas.state_consequence_instances i
      where i.subject_kind=p_subject_kind and i.subject_id=p_subject_id and i.status='open'
    loop
      update atlas.state_consequence_instances
      set status='resolved',resolved_at=now(),last_evaluated_at=now(),state_snapshot=v_snapshot,
          state_fingerprint=md5(v_snapshot::text)
      where id=v_instance.id;
      insert into atlas.state_consequence_events(
        farm_id,instance_id,policy_id,subject_kind,subject_id,event_kind,release_generation,idempotency_key,state_snapshot,metadata
      ) values (
        v_instance.farm_id,v_instance.id,v_instance.policy_id,p_subject_kind,p_subject_id,'resolved',v_instance.release_generation,
        'state-consequence:'||v_instance.id::text||':resolved:'||v_instance.release_generation::text,
        v_snapshot,jsonb_build_object('reason','subject_missing_or_unresolvable')
      ) on conflict(idempotency_key) do nothing;
    end loop;
    return jsonb_build_object('subjectKind',p_subject_kind,'subjectId',p_subject_id,'snapshot',v_snapshot,'openConsequences','[]'::jsonb);
  end if;

  v_fingerprint := md5(v_snapshot::text);

  for v_policy in
    select *
    from atlas.state_consequence_policies p
    where p.active
      and p.subject_kind=p_subject_kind
      and (p.farm_id is null or p.farm_id=v_farm_id)
    order by p.priority,p.stable_key
  loop
    v_matches := v_snapshot @> v_policy.subject_selector and v_snapshot @> v_policy.state_match;
    v_instance := null;
    select * into v_instance
    from atlas.state_consequence_instances i
    where i.policy_id=v_policy.id
      and i.subject_kind=p_subject_kind
      and i.subject_id=p_subject_id;

    v_payload := jsonb_build_object(
      'policyKey',v_policy.stable_key,
      'consequenceKind',v_policy.consequence_kind,
      'actionKey',v_policy.action_key,
      'audience',v_policy.audience,
      'priority',v_policy.priority,
      'actionSpec',v_policy.action_spec,
      'policyMetadata',v_policy.metadata
    );

    if v_matches then
      if v_instance.id is null then
        insert into atlas.state_consequence_instances(
          farm_id,policy_id,subject_kind,subject_id,consequence_key,consequence_kind,action_key,audience,priority,
          status,release_generation,state_fingerprint,state_snapshot,consequence_payload,released_at,last_evaluated_at,resolved_at
        ) values (
          v_farm_id,v_policy.id,p_subject_kind,p_subject_id,v_policy.stable_key||':'||p_subject_id::text,
          v_policy.consequence_kind,v_policy.action_key,v_policy.audience,v_policy.priority,
          'open',1,v_fingerprint,v_snapshot,v_payload,now(),now(),null
        ) returning * into v_instance;

        insert into atlas.state_consequence_events(
          farm_id,instance_id,policy_id,subject_kind,subject_id,event_kind,release_generation,idempotency_key,state_snapshot,metadata
        ) values (
          v_farm_id,v_instance.id,v_policy.id,p_subject_kind,p_subject_id,'released',1,
          'state-consequence:'||v_instance.id::text||':released:1',v_snapshot,
          jsonb_build_object('policyKey',v_policy.stable_key,'cause','state_predicate_became_true')
        ) on conflict(idempotency_key) do nothing;
      elsif v_instance.status='resolved' then
        v_generation := v_instance.release_generation+1;
        update atlas.state_consequence_instances
        set status='open',release_generation=v_generation,state_fingerprint=v_fingerprint,state_snapshot=v_snapshot,
            consequence_kind=v_policy.consequence_kind,action_key=v_policy.action_key,audience=v_policy.audience,priority=v_policy.priority,
            consequence_payload=v_payload,released_at=now(),last_evaluated_at=now(),resolved_at=null
        where id=v_instance.id
        returning * into v_instance;

        insert into atlas.state_consequence_events(
          farm_id,instance_id,policy_id,subject_kind,subject_id,event_kind,release_generation,idempotency_key,state_snapshot,metadata
        ) values (
          v_farm_id,v_instance.id,v_policy.id,p_subject_kind,p_subject_id,'released',v_generation,
          'state-consequence:'||v_instance.id::text||':released:'||v_generation::text,v_snapshot,
          jsonb_build_object('policyKey',v_policy.stable_key,'cause','state_predicate_became_true_again')
        ) on conflict(idempotency_key) do nothing;
      else
        update atlas.state_consequence_instances
        set state_fingerprint=v_fingerprint,state_snapshot=v_snapshot,consequence_kind=v_policy.consequence_kind,
            action_key=v_policy.action_key,audience=v_policy.audience,priority=v_policy.priority,
            consequence_payload=v_payload,last_evaluated_at=now()
        where id=v_instance.id;
      end if;
    elsif v_instance.id is not null and v_instance.status='open' then
      update atlas.state_consequence_instances
      set status='resolved',state_fingerprint=v_fingerprint,state_snapshot=v_snapshot,last_evaluated_at=now(),resolved_at=now()
      where id=v_instance.id;

      insert into atlas.state_consequence_events(
        farm_id,instance_id,policy_id,subject_kind,subject_id,event_kind,release_generation,idempotency_key,state_snapshot,metadata
      ) values (
        v_farm_id,v_instance.id,v_policy.id,p_subject_kind,p_subject_id,'resolved',v_instance.release_generation,
        'state-consequence:'||v_instance.id::text||':resolved:'||v_instance.release_generation::text,v_snapshot,
        jsonb_build_object('policyKey',v_policy.stable_key,'cause','state_predicate_no_longer_true')
      ) on conflict(idempotency_key) do nothing;
    end if;
  end loop;

  for v_instance in
    select i.*
    from atlas.state_consequence_instances i
    join atlas.state_consequence_policies p on p.id=i.policy_id
    where i.subject_kind=p_subject_kind
      and i.subject_id=p_subject_id
      and i.status='open'
      and not p.active
  loop
    update atlas.state_consequence_instances
    set status='resolved',state_fingerprint=v_fingerprint,state_snapshot=v_snapshot,last_evaluated_at=now(),resolved_at=now()
    where id=v_instance.id;
    insert into atlas.state_consequence_events(
      farm_id,instance_id,policy_id,subject_kind,subject_id,event_kind,release_generation,idempotency_key,state_snapshot,metadata
    ) values (
      v_instance.farm_id,v_instance.id,v_instance.policy_id,p_subject_kind,p_subject_id,'resolved',v_instance.release_generation,
      'state-consequence:'||v_instance.id::text||':resolved:'||v_instance.release_generation::text,v_snapshot,
      jsonb_build_object('cause','policy_inactive')
    ) on conflict(idempotency_key) do nothing;
  end loop;

  return jsonb_build_object(
    'subjectKind',p_subject_kind,
    'subjectId',p_subject_id,
    'snapshot',v_snapshot,
    'openConsequences',atlas.current_state_consequences_v1(p_subject_kind,p_subject_id)
  );
end;
$$;

revoke all on function atlas.reconcile_state_consequences_v1(text,uuid) from public, anon, authenticated;
grant execute on function atlas.reconcile_state_consequences_v1(text,uuid) to service_role;

create or replace function atlas.reconcile_resource_state_consequences_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.reconcile_state_consequences_v1('resource',case when tg_op='DELETE' then old.resource_id else new.resource_id end);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function atlas.reconcile_resource_policy_consequences_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.reconcile_state_consequences_v1('resource',case when tg_op='DELETE' then old.resource_id else new.resource_id end);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function atlas.reconcile_task_resource_consequences_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare v_resource_id uuid;
begin
  v_resource_id := case when tg_op='DELETE' then old.resource_id else new.resource_id end;
  if v_resource_id is not null then
    perform atlas.reconcile_state_consequences_v1('resource',v_resource_id);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function atlas.reconcile_seed_state_consequences_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.reconcile_state_consequences_v1('seed_lot',case when tg_op='DELETE' then old.seed_lot_id else new.seed_lot_id end);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function atlas.reconcile_seed_allocation_consequences_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.reconcile_state_consequences_v1('seed_lot',case when tg_op='DELETE' then old.seed_lot_id else new.seed_lot_id end);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function atlas.reconcile_flower_harvest_batch_consequences_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.reconcile_state_consequences_v1('flower_harvest_batch',case when tg_op='DELETE' then old.id else new.id end);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function atlas.reconcile_flower_harvest_observation_consequences_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.reconcile_state_consequences_v1('flower_harvest_batch',case when tg_op='DELETE' then old.batch_id else new.batch_id end);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function atlas.reconcile_flower_preparation_consequences_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.reconcile_state_consequences_v1('flower_harvest_batch',case when tg_op='DELETE' then old.harvest_batch_id else new.harvest_batch_id end);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists or6_reconcile_resource_operational_state on atlas.resource_operational_state;
create trigger or6_reconcile_resource_operational_state
after insert or update or delete on atlas.resource_operational_state
for each row execute function atlas.reconcile_resource_state_consequences_trigger_v1();

drop trigger if exists or6_reconcile_resource_stock_policy on atlas.resource_stock_policies;
create trigger or6_reconcile_resource_stock_policy
after insert or update or delete on atlas.resource_stock_policies
for each row execute function atlas.reconcile_resource_policy_consequences_trigger_v1();

drop trigger if exists or6_reconcile_task_resource_requirement on atlas.task_resource_requirements;
create trigger or6_reconcile_task_resource_requirement
after insert or update or delete on atlas.task_resource_requirements
for each row execute function atlas.reconcile_task_resource_consequences_trigger_v1();

drop trigger if exists or6_reconcile_seed_inventory_state on atlas.seed_inventory_state;
create trigger or6_reconcile_seed_inventory_state
after insert or update or delete on atlas.seed_inventory_state
for each row execute function atlas.reconcile_seed_state_consequences_trigger_v1();

drop trigger if exists or6_reconcile_seed_lot_allocation on atlas.seed_lot_allocations;
create trigger or6_reconcile_seed_lot_allocation
after insert or update or delete on atlas.seed_lot_allocations
for each row execute function atlas.reconcile_seed_allocation_consequences_trigger_v1();

drop trigger if exists or6_reconcile_flower_harvest_batch on atlas.flower_harvest_batches;
create trigger or6_reconcile_flower_harvest_batch
after insert or update or delete on atlas.flower_harvest_batches
for each row execute function atlas.reconcile_flower_harvest_batch_consequences_trigger_v1();

drop trigger if exists or6_reconcile_flower_harvest_observation on atlas.flower_harvest_bucket_observations;
create trigger or6_reconcile_flower_harvest_observation
after insert or update or delete on atlas.flower_harvest_bucket_observations
for each row execute function atlas.reconcile_flower_harvest_observation_consequences_trigger_v1();

drop trigger if exists or6_reconcile_flower_preparation_batch on atlas.flower_preparation_batches;
create trigger or6_reconcile_flower_preparation_batch
after insert or update or delete on atlas.flower_preparation_batches
for each row execute function atlas.reconcile_flower_preparation_consequences_trigger_v1();

insert into atlas.state_consequence_policies(
  stable_key,subject_kind,subject_selector,state_match,consequence_kind,action_key,audience,priority,action_spec,metadata
) values
(
  'resource-reusable-energy-unknown','resource',
  jsonb_build_object('resourceRole','reusable_energy_set'),jsonb_build_object('readinessState','unknown'),
  'verification','verify_resource_ready','farm_operations',10,
  jsonb_build_object('state','verification_required','action','ready_confirmed','actionLabel','Ready for use','promptMode','confirm_ready'),
  jsonb_build_object('contract','operation_result_or6','dependencyClass','completion_consequence')
),
(
  'resource-reusable-energy-needs-charge','resource',
  jsonb_build_object('resourceRole','reusable_energy_set'),jsonb_build_object('readinessState','needs_charge'),
  'reset','charge_resource','farm_operations',10,
  jsonb_build_object('state','reset_required','action','charging_started','actionLabel','Batteries plugged in','promptMode','charge_for_next_time'),
  jsonb_build_object('contract','operation_result_or6','dependencyClass','completion_consequence')
),
(
  'resource-reusable-energy-charging','resource',
  jsonb_build_object('resourceRole','reusable_energy_set'),jsonb_build_object('readinessState','charging'),
  'reset_confirmation','confirm_resource_ready','farm_operations',10,
  jsonb_build_object('state','charging','action','ready_confirmed','actionLabel','Ready for use','promptMode','confirm_after_reset'),
  jsonb_build_object('contract','operation_result_or6','dependencyClass','completion_consequence')
),
(
  'resource-quantity-count-required','resource',
  jsonb_build_object('quantityGoverned',true),jsonb_build_object('inventoryState','count_required'),
  'inspection','count_resource','farm_operations',20,
  jsonb_build_object('state','count_required','action','counted','actionLabel','Record count','promptMode','count'),
  jsonb_build_object('contract','operation_result_or6','truthBoundary','unknown_is_not_zero')
),
(
  'resource-quantity-requirement-quantity-required','resource',
  jsonb_build_object('quantityGoverned',true),jsonb_build_object('inventoryState','requirement_quantity_required'),
  'planning_resolution','define_resource_requirement_quantity','farm_operations_management',20,
  jsonb_build_object('state','requirement_quantity_required','action','define_requirement_quantity','actionLabel','Set quantity needed','promptMode','define_requirement_quantity'),
  jsonb_build_object('contract','operation_result_or6')
),
(
  'resource-quantity-restock-required','resource',
  jsonb_build_object('quantityGoverned',true),jsonb_build_object('inventoryState','restock_required'),
  'restock','restock_resource','farm_operations_management',20,
  jsonb_build_object('state','restock_required','action','restock','actionLabel','Restock','promptMode','restock'),
  jsonb_build_object('contract','operation_result_or6','principalBoundary','ordinary_restock_stays_operations_until_authority_or_capital_threshold')
),
(
  'seed-untrusted-with-future-commitments','seed_lot','{}'::jsonb,
  jsonb_build_object('countTrusted',false,'hasFutureCommitments',true),
  'inspection','count_seed_lot','farm_operations',20,
  jsonb_build_object('action','count_seed_lot','actionLabel','Count seed','promptMode','seed_count'),
  jsonb_build_object('contract','operation_result_or6','truthBoundary','do_not_buy_from_untrusted_count')
),
(
  'seed-trusted-shortfall','seed_lot','{}'::jsonb,
  jsonb_build_object('countTrusted',true,'hasTrustedShortfall',true),
  'decision_evaluation','resolve_seed_shortfall','farm_operations_management',30,
  jsonb_build_object('action','resolve_seed_shortfall','actionLabel','Resolve seed shortfall','promptMode','seed_shortfall'),
  jsonb_build_object('contract','operation_result_or6','domainHandler','sync_seed_inventory_dependency_tasks_v1','principalBoundary','escalate_only_if_authority_capital_or_committed_window_requires_it')
),
(
  'flower-harvest-output-needs-preparation','flower_harvest_batch','{}'::jsonb,
  jsonb_build_object('physicalOutputObserved',true,'preparationState','unprepared'),
  'preparation','prepare_harvest_output','farm_operations',20,
  jsonb_build_object('action','prepare_harvest_output','actionLabel','Prepare harvested flowers','promptMode','harvest_preparation'),
  jsonb_build_object('contract','operation_result_or6','domainHandler','ensure_flower_preparation_task_v1','truthBoundary','harvested_output_is_not_ready_inventory')
)
on conflict(stable_key) do update set
  subject_kind=excluded.subject_kind,
  subject_selector=excluded.subject_selector,
  state_match=excluded.state_match,
  consequence_kind=excluded.consequence_kind,
  action_key=excluded.action_key,
  audience=excluded.audience,
  priority=excluded.priority,
  action_spec=excluded.action_spec,
  active=true,
  metadata=excluded.metadata,
  updated_at=now();

do $$
declare v record;
begin
  for v in select id from atlas.resources where coalesce(metadata->>'generic_event_state_enabled','false')='true' loop
    perform atlas.reconcile_state_consequences_v1('resource',v.id);
  end loop;
  for v in select id from atlas.seed_lots loop
    perform atlas.reconcile_state_consequences_v1('seed_lot',v.id);
  end loop;
  for v in select id from atlas.flower_harvest_batches loop
    perform atlas.reconcile_state_consequences_v1('flower_harvest_batch',v.id);
  end loop;
end $$;