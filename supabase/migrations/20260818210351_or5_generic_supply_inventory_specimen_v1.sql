create table if not exists atlas.resource_stock_policies (
  resource_id uuid primary key references atlas.resources(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  stock_floor numeric null check (stock_floor is null or stock_floor >= 0),
  stock_target numeric null check (stock_target is null or stock_target >= 0),
  unit text not null,
  policy_source text not null default 'owner_policy',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resource_stock_policies_target_gte_floor
    check (stock_floor is null or stock_target is null or stock_target >= stock_floor)
);

comment on table atlas.resource_stock_policies is
'Optional floor/target policy for generic quantity-governed resources. Absence of a policy is preserved as insufficient warrant rather than treated as zero.';

alter table atlas.resource_stock_policies enable row level security;

drop policy if exists resource_stock_policies_read_operations on atlas.resource_stock_policies;
create policy resource_stock_policies_read_operations
on atlas.resource_stock_policies
for select
to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop trigger if exists set_resource_stock_policies_updated_at on atlas.resource_stock_policies;
create trigger set_resource_stock_policies_updated_at
before update on atlas.resource_stock_policies
for each row execute function atlas.set_updated_at();

create index if not exists resource_stock_policies_farm_id_idx
  on atlas.resource_stock_policies(farm_id);

create or replace function atlas.resource_inventory_position_v1(p_resource_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_resource atlas.resources%rowtype;
  v_state atlas.resource_operational_state%rowtype;
  v_policy atlas.resource_stock_policies%rowtype;
  v_committed_quantity numeric := 0;
  v_unquantified_committed integer := 0;
  v_check_first integer := 0;
  v_projected numeric;
  v_action text;
  v_acquire numeric;
begin
  select * into v_resource from atlas.resources where id = p_resource_id;
  if v_resource.id is null then
    return jsonb_build_object('state','resource_missing','resourceId',p_resource_id);
  end if;

  if coalesce(v_resource.metadata->>'quantity_governed','false') <> 'true' then
    return jsonb_build_object(
      'state','not_quantity_governed',
      'resourceId',v_resource.id,
      'resourceKey',v_resource.stable_key
    );
  end if;

  select * into v_state
  from atlas.resource_operational_state
  where resource_id = v_resource.id;

  select * into v_policy
  from atlas.resource_stock_policies
  where resource_id = v_resource.id;

  select
    coalesce(sum(r.quantity_needed) filter (
      where r.requirement_role in ('required','reserved')
        and r.quantity_needed is not null
    ),0),
    count(*) filter (
      where r.requirement_role in ('required','reserved')
        and r.quantity_needed is null
    )::int,
    count(*) filter (where r.requirement_role = 'check_first')::int
  into v_committed_quantity, v_unquantified_committed, v_check_first
  from atlas.task_resource_requirements r
  join atlas.tasks t on t.id = r.task_id
  where r.resource_id = v_resource.id
    and t.status not in ('done','archived','skipped')
    and r.status not in ('used','skipped');

  if v_state.resource_id is null or v_state.quantity_state <> 'known' then
    v_action := 'count_required';
    v_projected := null;
  else
    v_projected := v_state.known_quantity - v_committed_quantity;
    if v_unquantified_committed > 0 then
      v_action := 'requirement_quantity_required';
    elsif v_policy.resource_id is null or v_policy.stock_floor is null then
      v_action := 'known_no_stock_policy';
    elsif v_projected < v_policy.stock_floor then
      v_action := 'restock_required';
      v_acquire := greatest(coalesce(v_policy.stock_target,v_policy.stock_floor) - v_projected,0);
    else
      v_action := 'sufficient';
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'state',v_action,
    'resourceId',v_resource.id,
    'resourceKey',v_resource.stable_key,
    'label',v_resource.label,
    'unit',coalesce(v_state.unit,v_resource.unit,v_policy.unit),
    'quantityState',coalesce(v_state.quantity_state,'unknown'),
    'knownOnHand',v_state.known_quantity,
    'committedRequirementQuantity',v_committed_quantity,
    'unquantifiedCommittedRequirementCount',v_unquantified_committed,
    'checkFirstRequirementCount',v_check_first,
    'projectedRemainder',v_projected,
    'stockFloor',v_policy.stock_floor,
    'stockTarget',v_policy.stock_target,
    'policyConfigured',(v_policy.resource_id is not null and v_policy.stock_floor is not null),
    'suggestedAcquireQuantity',v_acquire,
    'epistemicClass',case
      when v_state.resource_id is null or v_state.quantity_state <> 'known' then 'unresolved'
      when v_unquantified_committed > 0 then 'unresolved'
      else 'established'
    end
  ));
end;
$$;

revoke all on function atlas.resource_inventory_position_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.resource_inventory_position_v1(uuid) to service_role;

create or replace function atlas.resource_inventory_continuation_v1(p_resource_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_resource atlas.resources%rowtype;
  v_position jsonb;
  v_state text;
  v_qty text;
begin
  select * into v_resource from atlas.resources where id=p_resource_id;
  if v_resource.id is null then
    return jsonb_build_object('state','resource_missing','humanActionRequired',false);
  end if;

  v_position := atlas.resource_inventory_position_v1(p_resource_id);
  v_state := v_position->>'state';

  if v_state='count_required' then
    return v_position || jsonb_build_object(
      'humanActionRequired',true,
      'action','counted',
      'actionLabel','Record count',
      'prompt','Count '||lower(v_resource.label)||'.'
    );
  elsif v_state='requirement_quantity_required' then
    return v_position || jsonb_build_object(
      'humanActionRequired',true,
      'action','define_requirement_quantity',
      'actionLabel','Set quantity needed',
      'prompt','Confirm how many '||lower(v_resource.label)||' the committed work requires.'
    );
  elsif v_state='restock_required' then
    v_qty := coalesce(v_position->>'suggestedAcquireQuantity','');
    return v_position || jsonb_build_object(
      'humanActionRequired',true,
      'action','restock',
      'actionLabel','Restock',
      'prompt',case when v_qty<>'' then 'Restock '||v_resource.label||' by at least '||v_qty||' '||coalesce(v_position->>'unit','units')||'.'
                    else 'Restock '||v_resource.label||'.' end
    );
  end if;

  return v_position || jsonb_build_object('humanActionRequired',false);
end;
$$;

revoke all on function atlas.resource_inventory_continuation_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.resource_inventory_continuation_v1(uuid) to service_role;

create or replace function atlas.resource_inventory_position_for_member_v1(
  p_farm_id uuid,
  p_resource_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_membership uuid;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  v_membership := atlas.current_membership_id(p_farm_id);
  if v_membership is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if not exists(select 1 from atlas.resources r where r.id=p_resource_id and r.farm_id=p_farm_id) then
    raise exception 'Resource does not belong to this farm.' using errcode='42501';
  end if;
  return atlas.resource_inventory_position_v1(p_resource_id)
    || jsonb_build_object('continuation',atlas.resource_inventory_continuation_v1(p_resource_id));
end;
$$;

revoke all on function atlas.resource_inventory_position_for_member_v1(uuid,uuid) from public, anon;
grant execute on function atlas.resource_inventory_position_for_member_v1(uuid,uuid) to authenticated, service_role;

create or replace function atlas.record_generic_inventory_event_for_member_v1(
  p_farm_id uuid,
  p_resource_id uuid,
  p_event_kind text,
  p_quantity numeric,
  p_idempotency_key text,
  p_source_task_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_membership uuid;
  v_resource atlas.resources%rowtype;
  v_observed numeric;
  v_delta numeric;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  v_membership := atlas.current_membership_id(p_farm_id);
  if v_membership is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_resource
  from atlas.resources
  where id=p_resource_id and farm_id=p_farm_id;
  if v_resource.id is null then
    raise exception 'Resource does not belong to this farm.' using errcode='42501';
  end if;
  if coalesce(v_resource.metadata->>'quantity_governed','false') <> 'true' then
    raise exception 'Resource is not governed by generic quantity inventory.' using errcode='22023';
  end if;
  if p_event_kind not in ('counted','received','consumed','damaged','discarded','depleted') then
    raise exception 'Unsupported generic inventory event.' using errcode='22023';
  end if;
  if p_event_kind in ('counted','received','consumed','damaged','discarded')
     and (p_quantity is null or p_quantity < 0 or (p_event_kind <> 'counted' and p_quantity = 0)) then
    raise exception 'A nonnegative count or positive movement quantity is required.' using errcode='22023';
  end if;

  if p_event_kind='counted' then
    v_observed := p_quantity;
  elsif p_event_kind='depleted' then
    v_observed := 0;
  elsif p_event_kind='received' then
    v_delta := p_quantity;
  else
    v_delta := -p_quantity;
  end if;

  v_result := atlas.record_resource_event_v1(
    p_resource_id,
    p_event_kind,
    p_idempotency_key,
    p_source_task_id,
    'generic_inventory',
    p_resource_id,
    v_membership,
    v_observed,
    v_delta,
    v_resource.unit,
    p_note,
    jsonb_build_object('contract','operation_result_or5')
  );

  return v_result
    || jsonb_build_object(
      'inventoryPosition',atlas.resource_inventory_position_v1(p_resource_id),
      'continuation',atlas.resource_inventory_continuation_v1(p_resource_id)
    );
end;
$$;

revoke all on function atlas.record_generic_inventory_event_for_member_v1(uuid,uuid,text,numeric,text,uuid,text) from public, anon;
grant execute on function atlas.record_generic_inventory_event_for_member_v1(uuid,uuid,text,numeric,text,uuid,text) to authenticated, service_role;

create or replace function atlas.resource_ready_for_requirement_v1(p_resource_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select coalesce((
    select case
      when coalesce(resource.metadata->>'quantity_governed','false')='true'
        then state.quantity_state='known' and coalesce(state.known_quantity,0) > 0
      when state.resource_id is not null
        then state.readiness_state='ready'
      else resource.status='available'
    end
    from atlas.resources resource
    left join atlas.resource_operational_state state on state.resource_id=resource.id
    where resource.id=p_resource_id
  ),false);
$$;

create or replace function atlas.task_required_resources_available_v1(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select coalesce((
    select
      not exists (
        select 1
        from atlas.task_resource_requirements requirement
        left join atlas.resources resource on resource.id=requirement.resource_id
        left join atlas.resource_operational_state state on state.resource_id=resource.id
        where requirement.task_id=task.id
          and requirement.requirement_role='required'
          and (
            resource.id is null
            or case
              when coalesce(resource.metadata->>'quantity_governed','false')='true'
                then state.quantity_state <> 'known'
                  or requirement.quantity_needed is null
                  or state.known_quantity < requirement.quantity_needed
              else not atlas.resource_ready_for_requirement_v1(resource.id)
            end
          )
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

create or replace function atlas.sync_resource_requirement_from_operational_state_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  update atlas.task_resource_requirements r
  set status=case
        when coalesce(resource.metadata->>'quantity_governed','false')='true' then
          case
            when new.quantity_state <> 'known' then 'needs_check'
            when r.requirement_role='check_first' then 'available'
            when r.quantity_needed is null then 'needs_check'
            when new.known_quantity >= r.quantity_needed then 'available'
            else 'needed'
          end
        when new.readiness_state='ready' then 'available'
        when new.readiness_state='unknown' then 'needs_check'
        else 'needed'
      end,
      updated_at=now()
  from atlas.resources resource
  where r.resource_id=new.resource_id
    and resource.id=new.resource_id
    and r.requirement_role in ('required','check_first')
    and r.status not in ('used','skipped');
  return new;
end;
$$;

create or replace function atlas.resource_immediate_continuation_v1(p_resource_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_resource atlas.resources%rowtype;
  v_state atlas.resource_operational_state%rowtype;
begin
  select * into v_resource from atlas.resources where id=p_resource_id;
  if v_resource.id is null then return jsonb_build_object('state','resource_missing','humanActionRequired',false); end if;

  if coalesce(v_resource.metadata->>'quantity_governed','false')='true' then
    return atlas.resource_inventory_continuation_v1(p_resource_id);
  end if;

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

-- Elm OR5 specimen: establish identity without fabricating quantity or stock policy.
insert into atlas.resources(
  farm_id,stable_key,label,resource_type,resource_category,status,quantity,unit,
  location_label,restock_needed,consumable,metadata
)
select
  t.farm_id,
  'venue_clear_cold_cups',
  'Clear cold cups',
  'consumable',
  'venue_supply',
  'unknown',
  null,
  'cups',
  'Coffee Bar',
  false,
  true,
  jsonb_build_object(
    'generic_event_state_enabled',true,
    'quantity_governed',true,
    'inventory_authority','atlas.resource_operational_state',
    'stock_policy_authority','atlas.resource_stock_policies',
    'governing_contract','operation_result_state_transition_or5',
    'quantity_truth','unknown_until_counted'
  )
from atlas.tasks t
where t.metadata->>'task_key'='anna_20260819_thursday_morning_coffee_water'
on conflict (farm_id,stable_key) do nothing;

insert into atlas.resource_operational_state(
  resource_id,farm_id,readiness_state,quantity_state,known_quantity,unit,state_reason
)
select
  r.id,r.farm_id,'unknown','unknown',null,r.unit,
  jsonb_build_object(
    'source','or5_initial_truth_boundary',
    'reason','No current witness establishes how many clear cold cups are on hand; unknown must remain unknown until counted.'
  )
from atlas.resources r
where r.stable_key='venue_clear_cold_cups'
  and coalesce(r.metadata->>'quantity_governed','false')='true'
on conflict (resource_id) do nothing;

insert into atlas.task_resource_requirements(
  task_id,resource_id,requirement_role,requirement_source,quantity_needed,unit,status,note,metadata
)
select
  t.id,r.id,'check_first','inventory_math',null,'cups','needs_check',
  'Count clear cold cups before service. Unknown quantity is not evidence of shortage and does not warrant a purchase.',
  jsonb_build_object(
    'source','operation_result_or5',
    'inventory_claim',false,
    'epistemic_class','unresolved',
    'reason','Committed Coffee + Water service uses clear cold cups, but no authoritative count or required quantity has been established.'
  )
from atlas.tasks t
join atlas.resources r on r.farm_id=t.farm_id and r.stable_key='venue_clear_cold_cups'
where t.metadata->>'task_key'='anna_20260819_thursday_morning_coffee_water'
  and not exists (
    select 1 from atlas.task_resource_requirements x
    where x.task_id=t.id and x.resource_id=r.id and x.requirement_role='check_first'
  );