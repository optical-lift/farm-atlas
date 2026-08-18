create table if not exists atlas.resource_stock_policies (
  resource_id uuid primary key references atlas.resources(id) on delete cascade,
  stocking_floor numeric not null check (stocking_floor >= 0),
  stocking_target numeric not null check (stocking_target >= stocking_floor),
  unit text not null check (length(btrim(unit)) > 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table atlas.resource_stock_policies enable row level security;
revoke all on atlas.resource_stock_policies from public,anon,authenticated;
grant select,insert,update,delete on atlas.resource_stock_policies to service_role;

create or replace function atlas.resource_requirement_ready_v1(p_requirement_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
  select coalesce((
    select case
      when resource.id is null then false
      when state.resource_id is not null then
        case
          when coalesce(resource.metadata->>'quantity_establishes_readiness','false')='true'
               and coalesce(resource.consumable,false)=true
               and requirement.quantity_needed is not null
            then state.readiness_state='ready'
             and state.quantity_state='known'
             and state.known_quantity >= requirement.quantity_needed
          else state.readiness_state='ready'
        end
      else
        case
          when coalesce(resource.metadata->>'quantity_establishes_readiness','false')='true'
               and coalesce(resource.consumable,false)=true
               and requirement.quantity_needed is not null
            then resource.status='available'
             and resource.quantity is not null
             and resource.quantity >= requirement.quantity_needed
          else resource.status='available'
        end
    end
    from atlas.task_resource_requirements requirement
    left join atlas.resources resource on resource.id=requirement.resource_id
    left join atlas.resource_operational_state state on state.resource_id=resource.id
    where requirement.id=p_requirement_id
  ),false);
$function$;

revoke all on function atlas.resource_requirement_ready_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.resource_requirement_ready_v1(uuid) to service_role;

create or replace function atlas.task_required_resources_available_v1(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
  select coalesce((
    select
      not exists (
        select 1
        from atlas.task_resource_requirements requirement
        where requirement.task_id=task.id
          and requirement.requirement_role in ('required','consumed')
          and requirement.status not in ('used','skipped')
          and not atlas.resource_requirement_ready_v1(requirement.id)
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
$function$;

create or replace function atlas.apply_resource_event_state_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_state atlas.resource_operational_state%rowtype;
  v_readiness text;
  v_quantity_state text;
  v_quantity numeric;
  v_unit text;
  v_legacy_status text;
  v_quantity_establishes_readiness boolean := false;
begin
  insert into atlas.resource_operational_state(resource_id,farm_id,readiness_state,quantity_state,unit,state_reason)
  values(new.resource_id,new.farm_id,'unknown','unknown',new.unit,jsonb_build_object('source','resource_event_projection'))
  on conflict(resource_id) do nothing;

  select * into v_state
  from atlas.resource_operational_state
  where resource_id=new.resource_id
  for update;

  select coalesce(r.metadata->>'quantity_establishes_readiness','false')='true'
  into v_quantity_establishes_readiness
  from atlas.resources r
  where r.id=new.resource_id;

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

  if v_quantity_establishes_readiness
     and new.event_kind in ('counted','received','consumed','damaged','discarded','depleted') then
    if v_quantity_state='known' then
      v_readiness:=case when coalesce(v_quantity,0)>0 then 'ready' else 'unavailable' end;
    else
      v_readiness:='unknown';
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

  v_legacy_status:=case
    when v_quantity_establishes_readiness and v_readiness='unavailable' then 'needs_purchase'
    when v_readiness='ready' then 'available'
    when v_readiness='unknown' then 'unknown'
    when v_readiness='unavailable' then 'needs_repair'
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
$function$;

create or replace function atlas.sync_resource_requirement_from_operational_state_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  update atlas.task_resource_requirements r
  set status=case
        when atlas.resource_requirement_ready_v1(r.id) then 'available'
        when new.readiness_state='unknown' or new.quantity_state='unknown' then 'needs_check'
        else 'needed'
      end,
      updated_at=now()
  where r.resource_id=new.resource_id
    and r.requirement_role in ('required','consumed')
    and r.status not in ('used','skipped');
  return new;
end;
$function$;

drop trigger if exists resource_operational_state_sync_requirements_v1 on atlas.resource_operational_state;
create trigger resource_operational_state_sync_requirements_v1
after insert or update of readiness_state,quantity_state,known_quantity,unit on atlas.resource_operational_state
for each row execute function atlas.sync_resource_requirement_from_operational_state_v1();

create or replace function atlas.generic_resource_stock_position_v1(p_resource_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_resource atlas.resources%rowtype;
  v_state atlas.resource_operational_state%rowtype;
  v_policy atlas.resource_stock_policies%rowtype;
  v_unit text;
  v_demand numeric := 0;
  v_demand_count integer := 0;
  v_unquantified_count integer := 0;
  v_unit_mismatch_count integer := 0;
  v_check_first_count integer := 0;
  v_earliest_date date;
  v_known numeric;
  v_projected numeric;
  v_restock numeric;
  v_state_key text;
begin
  select * into v_resource from atlas.resources where id=p_resource_id;
  if v_resource.id is null then raise exception 'Resource not found.' using errcode='P0002'; end if;
  select * into v_state from atlas.resource_operational_state where resource_id=v_resource.id;
  select * into v_policy from atlas.resource_stock_policies where resource_id=v_resource.id and active=true;
  v_unit:=coalesce(v_policy.unit,v_state.unit,v_resource.unit);

  select
    coalesce(sum(case when r.quantity_needed is not null and (r.unit is null or v_unit is null or lower(btrim(r.unit))=lower(btrim(v_unit))) then r.quantity_needed else 0 end),0),
    count(*) filter (where r.quantity_needed is not null)::integer,
    count(*) filter (where r.quantity_needed is null)::integer,
    count(*) filter (where r.quantity_needed is not null and r.unit is not null and v_unit is not null and lower(btrim(r.unit))<>lower(btrim(v_unit)))::integer,
    min(t.due_date)
  into v_demand,v_demand_count,v_unquantified_count,v_unit_mismatch_count,v_earliest_date
  from atlas.task_resource_requirements r
  join atlas.tasks t on t.id=r.task_id
  where r.resource_id=v_resource.id
    and r.requirement_role='consumed'
    and r.status not in ('used','skipped')
    and t.status in ('open','blocked');

  select count(*)::integer,least(v_earliest_date,min(t.due_date))
  into v_check_first_count,v_earliest_date
  from atlas.task_resource_requirements r
  join atlas.tasks t on t.id=r.task_id
  where r.resource_id=v_resource.id
    and r.requirement_role='check_first'
    and r.status not in ('used','skipped')
    and t.status in ('open','blocked');

  if v_state.resource_id is null or v_state.quantity_state<>'known' then
    v_state_key:=case
      when v_policy.resource_id is not null or v_check_first_count>0 or v_demand_count>0 or v_unquantified_count>0 then 'count_required'
      else 'quantity_unknown_no_active_claim'
    end;
  else
    v_known:=v_state.known_quantity;
    if v_unquantified_count>0 or v_unit_mismatch_count>0 then
      v_state_key:='requirement_reconciliation_required';
    else
      v_projected:=v_known-v_demand;
      if v_policy.resource_id is not null and v_projected < v_policy.stocking_floor then
        v_state_key:='restock_required';
        v_restock:=greatest(v_policy.stocking_target+v_demand-v_known,0);
      else
        v_state_key:='sufficient';
        v_restock:=0;
      end if;
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','generic_resource_stock_position_v1',
    'resourceId',v_resource.id,
    'resourceKey',v_resource.stable_key,
    'resourceLabel',v_resource.label,
    'state',v_state_key,
    'unit',v_unit,
    'readinessState',coalesce(v_state.readiness_state,'unknown'),
    'quantityState',coalesce(v_state.quantity_state,'unknown'),
    'knownOnHand',v_known,
    'committedDemandQuantity',v_demand,
    'quantifiedDemandCount',v_demand_count,
    'unquantifiedDemandCount',v_unquantified_count,
    'unitMismatchCount',v_unit_mismatch_count,
    'checkFirstClaimCount',v_check_first_count,
    'earliestRequirementDate',v_earliest_date,
    'stockingFloor',case when v_policy.resource_id is not null then v_policy.stocking_floor end,
    'stockingTarget',case when v_policy.resource_id is not null then v_policy.stocking_target end,
    'projectedRemainder',v_projected,
    'restockQuantityToTarget',v_restock,
    'truthBoundary',jsonb_build_object(
      'unknownIsNotZero',true,
      'physicalExistenceIsNotQuantitySufficiency',true,
      'stockPolicyIsNotDemand',true,
      'taskRequirementIsNotConsumptionUntilResult',true
    )
  ));
end;
$function$;

revoke all on function atlas.generic_resource_stock_position_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.generic_resource_stock_position_v1(uuid) to service_role;