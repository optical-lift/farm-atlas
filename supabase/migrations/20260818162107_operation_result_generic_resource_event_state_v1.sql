create table if not exists atlas.resource_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  resource_id uuid not null references atlas.resources(id) on delete restrict,
  source_task_id uuid references atlas.tasks(id) on delete set null,
  source_kind text,
  source_id uuid,
  event_kind text not null check (event_kind in (
    'charge_consumed','charging_started','ready_confirmed','received','consumed','counted',
    'reserved','released','damaged','discarded','depleted','unavailable_observed'
  )),
  observed_at timestamptz not null default now(),
  observed_quantity numeric,
  quantity_delta numeric,
  unit text,
  effective_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  created_by_user_id uuid,
  idempotency_key text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(resource_id,idempotency_key)
);

create index if not exists resource_events_farm_observed_idx
  on atlas.resource_events(farm_id,observed_at desc,id desc);
create index if not exists resource_events_task_idx
  on atlas.resource_events(source_task_id,observed_at desc) where source_task_id is not null;

create table if not exists atlas.resource_operational_state (
  resource_id uuid primary key references atlas.resources(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  readiness_state text not null default 'unknown' check (readiness_state in ('unknown','ready','needs_charge','charging','unavailable')),
  quantity_state text not null default 'unknown' check (quantity_state in ('unknown','known','not_applicable')),
  known_quantity numeric,
  unit text,
  last_event_id uuid references atlas.resource_events(id) on delete set null,
  last_observed_at timestamptz,
  state_reason jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check ((quantity_state='known' and known_quantity is not null) or quantity_state<>'known')
);

create index if not exists resource_operational_state_farm_readiness_idx
  on atlas.resource_operational_state(farm_id,readiness_state,updated_at desc);

alter table atlas.resource_events enable row level security;
alter table atlas.resource_operational_state enable row level security;
revoke all on table atlas.resource_events from public,anon,authenticated;
revoke all on table atlas.resource_operational_state from public,anon,authenticated;
grant all on table atlas.resource_events to service_role;
grant all on table atlas.resource_operational_state to service_role;

create or replace function atlas.prevent_resource_event_mutation_v1()
returns trigger
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $$
begin
  raise exception 'Generic resource events are append-only.' using errcode='55000';
end;
$$;

drop trigger if exists resource_events_immutable_v1 on atlas.resource_events;
create trigger resource_events_immutable_v1
before update or delete on atlas.resource_events
for each row execute function atlas.prevent_resource_event_mutation_v1();

create or replace function atlas.apply_resource_event_state_v1()
returns trigger
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_state atlas.resource_operational_state%rowtype;
  v_readiness text;
  v_quantity_state text;
  v_quantity numeric;
  v_unit text;
  v_legacy_status text;
begin
  insert into atlas.resource_operational_state(resource_id,farm_id,readiness_state,quantity_state,unit,state_reason)
  values(new.resource_id,new.farm_id,'unknown','unknown',new.unit,jsonb_build_object('source','resource_event_projection'))
  on conflict(resource_id) do nothing;

  select * into v_state
  from atlas.resource_operational_state
  where resource_id=new.resource_id
  for update;

  v_readiness:=v_state.readiness_state;
  v_quantity_state:=v_state.quantity_state;
  v_quantity:=v_state.known_quantity;
  v_unit:=coalesce(new.unit,v_state.unit);

  if new.event_kind='charge_consumed' then
    v_readiness:='needs_charge';
  elsif new.event_kind='charging_started' then
    v_readiness:='charging';
  elsif new.event_kind='ready_confirmed' then
    v_readiness:='ready';
  elsif new.event_kind='unavailable_observed' then
    v_readiness:='unavailable';
  end if;

  if new.event_kind='counted' then
    if new.observed_quantity is null then
      raise exception 'A counted resource event requires observed quantity.' using errcode='22023';
    end if;
    v_quantity_state:='known';
    v_quantity:=new.observed_quantity;
  elsif new.event_kind in ('received','consumed','damaged','discarded','depleted') then
    if new.observed_quantity is not null then
      v_quantity_state:='known';
      v_quantity:=new.observed_quantity;
    elsif v_quantity_state='known' and new.quantity_delta is not null then
      v_quantity:=greatest(v_quantity+new.quantity_delta,0);
    else
      v_quantity_state:='unknown';
      v_quantity:=null;
    end if;
    if new.event_kind='depleted' and v_quantity_state='known' then
      v_quantity:=0;
    end if;
  end if;

  update atlas.resource_operational_state
  set readiness_state=v_readiness,
      quantity_state=v_quantity_state,
      known_quantity=case when v_quantity_state='known' then v_quantity else null end,
      unit=v_unit,
      last_event_id=new.id,
      last_observed_at=new.observed_at,
      state_reason=jsonb_build_object(
        'source','resource_event','eventId',new.id,'eventKind',new.event_kind,
        'sourceTaskId',new.source_task_id,'sourceKind',new.source_kind,'sourceId',new.source_id
      ),
      updated_at=now()
  where resource_id=new.resource_id;

  v_legacy_status:=case v_readiness
    when 'ready' then 'available'
    when 'unknown' then 'unknown'
    when 'unavailable' then 'needs_repair'
    else 'needs_check'
  end;

  update atlas.resources
  set status=v_legacy_status,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'operational_state_source','atlas.resource_operational_state',
        'operational_readiness_state',v_readiness
      ),
      updated_at=now()
  where id=new.resource_id
    and coalesce(metadata->>'generic_event_state_enabled','false')='true';

  return new;
end;
$$;

drop trigger if exists resource_events_project_state_v1 on atlas.resource_events;
create trigger resource_events_project_state_v1
after insert on atlas.resource_events
for each row execute function atlas.apply_resource_event_state_v1();

create or replace function atlas.sync_resource_requirement_from_operational_state_v1()
returns trigger
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $$
begin
  update atlas.task_resource_requirements r
  set status=case
        when new.readiness_state='ready' then 'available'
        when new.readiness_state='unknown' then 'needs_check'
        else 'needed'
      end,
      updated_at=now()
  where r.resource_id=new.resource_id
    and r.requirement_role='required'
    and r.status not in ('used','skipped');
  return new;
end;
$$;

drop trigger if exists resource_operational_state_sync_requirements_v1 on atlas.resource_operational_state;
create trigger resource_operational_state_sync_requirements_v1
after insert or update of readiness_state on atlas.resource_operational_state
for each row execute function atlas.sync_resource_requirement_from_operational_state_v1();

create or replace function atlas.resource_ready_for_requirement_v1(p_resource_id uuid)
returns boolean
language sql stable security definer
set search_path to 'pg_catalog','atlas'
as $$
  select coalesce((
    select case
      when state.resource_id is not null then state.readiness_state='ready'
      else resource.status='available'
    end
    from atlas.resources resource
    left join atlas.resource_operational_state state on state.resource_id=resource.id
    where resource.id=p_resource_id
  ),false);
$$;

create or replace function atlas.task_required_resources_available_v1(p_task_id uuid)
returns boolean
language sql stable security definer
set search_path to 'pg_catalog','atlas'
as $$
  select coalesce((
    select
      not exists (
        select 1
        from atlas.task_resource_requirements requirement
        left join atlas.resources resource on resource.id=requirement.resource_id
        where requirement.task_id=task.id
          and requirement.requirement_role='required'
          and (resource.id is null or not atlas.resource_ready_for_requirement_v1(resource.id))
      )
      and not exists (
        select 1
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(coalesce(task.metadata->'required_resource_keys','[]'::jsonb))='array'
              then coalesce(task.metadata->'required_resource_keys','[]'::jsonb)
            else '[]'::jsonb
          end
        ) wanted(stable_key)
        left join atlas.resources resource
          on resource.farm_id=task.farm_id
         and resource.stable_key=wanted.stable_key
        where resource.id is null or not atlas.resource_ready_for_requirement_v1(resource.id)
      )
    from atlas.tasks task
    where task.id=p_task_id
  ),false);
$$;

create or replace function atlas.record_resource_event_v1(
  p_resource_id uuid,
  p_event_kind text,
  p_idempotency_key text,
  p_source_task_id uuid default null,
  p_source_kind text default null,
  p_source_id uuid default null,
  p_effective_membership_id uuid default null,
  p_observed_quantity numeric default null,
  p_quantity_delta numeric default null,
  p_unit text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql volatile security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_resource atlas.resources%rowtype;
  v_existing atlas.resource_events%rowtype;
  v_event atlas.resource_events%rowtype;
  v_state atlas.resource_operational_state%rowtype;
  v_actor_user uuid;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
begin
  if p_resource_id is null or v_key is null or length(v_key)>200 then
    raise exception 'Resource and idempotency key are required.' using errcode='22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' then
    raise exception 'Resource-event metadata must be a JSON object.' using errcode='22023';
  end if;

  select * into v_resource from atlas.resources where id=p_resource_id;
  if v_resource.id is null then raise exception 'Resource not found.' using errcode='P0002'; end if;
  if coalesce(v_resource.metadata->>'generic_event_state_enabled','false')<>'true' then
    raise exception 'This resource is governed by another state contract or has not enabled generic event state.' using errcode='22023';
  end if;
  if p_source_task_id is not null and not exists(
    select 1 from atlas.tasks t where t.id=p_source_task_id and t.farm_id=v_resource.farm_id
  ) then
    raise exception 'Source task does not belong to the resource farm.' using errcode='22023';
  end if;
  if p_effective_membership_id is not null then
    select fm.user_id into v_actor_user
    from atlas.farm_memberships fm
    where fm.id=p_effective_membership_id and fm.farm_id=v_resource.farm_id and fm.active=true;
    if not found then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_resource.id::text||':resource-event:'||v_key,0));
  select * into v_existing
  from atlas.resource_events
  where resource_id=v_resource.id and idempotency_key=v_key;
  if v_existing.id is not null then
    select * into v_state from atlas.resource_operational_state where resource_id=v_resource.id;
    return jsonb_build_object(
      'eventId',v_existing.id,'resourceId',v_resource.id,'eventKind',v_existing.event_kind,
      'deduplicated',true,'state',to_jsonb(v_state)
    );
  end if;

  insert into atlas.resource_events(
    farm_id,resource_id,source_task_id,source_kind,source_id,event_kind,observed_at,
    observed_quantity,quantity_delta,unit,effective_membership_id,created_by_user_id,
    idempotency_key,note,metadata
  ) values(
    v_resource.farm_id,v_resource.id,p_source_task_id,nullif(btrim(coalesce(p_source_kind,'')),''),p_source_id,
    p_event_kind,now(),p_observed_quantity,p_quantity_delta,p_unit,p_effective_membership_id,
    coalesce(v_actor_user,auth.uid()),v_key,nullif(btrim(coalesce(p_note,'')),''),p_metadata
  ) returning * into v_event;

  select * into v_state from atlas.resource_operational_state where resource_id=v_resource.id;
  return jsonb_build_object(
    'eventId',v_event.id,'resourceId',v_resource.id,'eventKind',v_event.event_kind,
    'deduplicated',false,'state',to_jsonb(v_state)
  );
end;
$$;

create or replace function atlas.resource_immediate_continuation_v1(p_resource_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_resource atlas.resources%rowtype;
  v_state atlas.resource_operational_state%rowtype;
begin
  select * into v_resource from atlas.resources where id=p_resource_id;
  if v_resource.id is null then return jsonb_build_object('state','resource_missing','humanActionRequired',false); end if;
  select * into v_state from atlas.resource_operational_state where resource_id=p_resource_id;
  if v_state.resource_id is null then
    return jsonb_build_object('state','legacy_resource_no_generic_state','humanActionRequired',false);
  end if;

  if v_state.readiness_state='needs_charge' then
    return jsonb_build_object(
      'state','reset_required','resourceId',v_resource.id,'resourceKey',v_resource.stable_key,
      'action','charging_started','actionLabel','Batteries plugged in',
      'prompt',case when v_resource.stable_key='battery_push_mower_battery_set'
        then 'Good work. Charge the batteries for next time!'
        else 'Reset '||v_resource.label||' for next use.' end,
      'humanActionRequired',true
    );
  elsif v_state.readiness_state='charging' then
    return jsonb_build_object(
      'state','charging','resourceId',v_resource.id,'resourceKey',v_resource.stable_key,
      'action','ready_confirmed','actionLabel','Ready for use',
      'prompt',case when v_resource.stable_key='battery_push_mower_battery_set'
        then 'When the batteries are charged, confirm they are ready.'
        else 'Confirm '||v_resource.label||' is ready when reset is complete.' end,
      'humanActionRequired',true
    );
  elsif v_state.readiness_state='unknown' then
    return jsonb_build_object(
      'state','verification_required','resourceId',v_resource.id,'resourceKey',v_resource.stable_key,
      'action','ready_confirmed','actionLabel','Ready for use',
      'prompt','Confirm '||v_resource.label||' is ready before use.',
      'humanActionRequired',true
    );
  elsif v_state.readiness_state='ready' then
    return jsonb_build_object('state','ready','resourceId',v_resource.id,'resourceKey',v_resource.stable_key,'humanActionRequired',false);
  end if;

  return jsonb_build_object(
    'state','unavailable','resourceId',v_resource.id,'resourceKey',v_resource.stable_key,
    'humanActionRequired',true,'action','management_resolution',
    'prompt',v_resource.label||' is unavailable and needs resolution before use.'
  );
end;
$$;

create or replace function atlas.record_resource_reset_for_member_v1(
  p_farm_id uuid,
  p_resource_id uuid,
  p_action text,
  p_idempotency_key text,
  p_note text default null
) returns jsonb
language plpgsql volatile security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_membership uuid;
  v_event_kind text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_membership:=atlas.current_membership_id(p_farm_id);
  if v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.resources r where r.id=p_resource_id and r.farm_id=p_farm_id) then
    raise exception 'Resource does not belong to this farm.' using errcode='42501';
  end if;

  v_event_kind:=case p_action
    when 'charging_started' then 'charging_started'
    when 'batteries_plugged_in' then 'charging_started'
    when 'ready_confirmed' then 'ready_confirmed'
    else null end;
  if v_event_kind is null then raise exception 'Unsupported resource reset action.' using errcode='22023'; end if;

  v_result:=atlas.record_resource_event_v1(
    p_resource_id,v_event_kind,p_idempotency_key,null,'resource_reset',p_resource_id,
    v_membership,null,null,null,p_note,jsonb_build_object('action',p_action)
  );
  return v_result||jsonb_build_object('continuation',atlas.resource_immediate_continuation_v1(p_resource_id));
end;
$$;

revoke all on function atlas.prevent_resource_event_mutation_v1() from public,anon,authenticated;
revoke all on function atlas.apply_resource_event_state_v1() from public,anon,authenticated;
revoke all on function atlas.sync_resource_requirement_from_operational_state_v1() from public,anon,authenticated;
revoke all on function atlas.resource_ready_for_requirement_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.record_resource_event_v1(uuid,text,text,uuid,text,uuid,uuid,numeric,numeric,text,text,jsonb) from public,anon,authenticated;
revoke all on function atlas.resource_immediate_continuation_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.record_resource_reset_for_member_v1(uuid,uuid,text,text,text) from public,anon;

grant execute on function atlas.resource_ready_for_requirement_v1(uuid) to service_role;
grant execute on function atlas.record_resource_event_v1(uuid,text,text,uuid,text,uuid,uuid,numeric,numeric,text,text,jsonb) to service_role;
grant execute on function atlas.resource_immediate_continuation_v1(uuid) to service_role;
grant execute on function atlas.record_resource_reset_for_member_v1(uuid,uuid,text,text,text) to authenticated,service_role;

comment on table atlas.resource_events is
'Generic append-only operational resource events for resources without a stronger domain ledger. Seed, Harvest, and other domain-owned inventory remain on their own canonical ledgers.';
comment on table atlas.resource_operational_state is
'Projection of generic resource readiness/known quantity. Unknown remains unknown until evidence establishes otherwise.';
comment on function atlas.record_resource_event_v1(uuid,text,text,uuid,text,uuid,uuid,numeric,numeric,text,text,jsonb) is
'Internal generic resource effect recorder for the shared Operation → Result → State Transition membrane. Does not replace domain-specific seed or Harvest events.';