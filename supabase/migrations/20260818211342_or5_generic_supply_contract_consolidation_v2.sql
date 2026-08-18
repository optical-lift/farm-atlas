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
      when coalesce(resource.metadata->>'quantity_governed','false')='true' then
        case
          when state.resource_id is null or state.quantity_state<>'known' then false
          when requirement.quantity_needed is null then coalesce(state.known_quantity,0)>0
          else coalesce(state.known_quantity,0)>=requirement.quantity_needed
        end
      when state.resource_id is not null then state.readiness_state='ready'
      else resource.status='available'
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

create or replace function atlas.sync_resource_requirement_from_operational_state_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  update atlas.task_resource_requirements r
  set status=case
        when coalesce(resource.metadata->>'quantity_governed','false')='true' then
          case
            when new.quantity_state<>'known' then 'needs_check'
            when r.requirement_role='check_first' then 'available'
            when r.quantity_needed is null then 'needs_check'
            when coalesce(new.known_quantity,0)>=r.quantity_needed then 'available'
            else 'needed'
          end
        when r.requirement_role='check_first' then
          case when new.readiness_state='ready' then 'available' else 'needs_check' end
        when atlas.resource_requirement_ready_v1(r.id) then 'available'
        when new.readiness_state='unknown' then 'needs_check'
        else 'needed'
      end,
      updated_at=now()
  from atlas.resources resource
  where r.resource_id=new.resource_id
    and resource.id=new.resource_id
    and r.requirement_role in ('required','consumed','check_first')
    and r.status not in ('used','skipped');
  return new;
end;
$function$;

drop trigger if exists resource_operational_state_sync_requirements_v1 on atlas.resource_operational_state;
create trigger resource_operational_state_sync_requirements_v1
after insert or update of readiness_state,quantity_state,known_quantity,unit on atlas.resource_operational_state
for each row execute function atlas.sync_resource_requirement_from_operational_state_v1();

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
  v_quantity_governed boolean:=false;
  v_quantity_establishes_readiness boolean:=false;
begin
  insert into atlas.resource_operational_state(resource_id,farm_id,readiness_state,quantity_state,unit,state_reason)
  values(new.resource_id,new.farm_id,'unknown','unknown',new.unit,jsonb_build_object('source','resource_event_projection'))
  on conflict(resource_id) do nothing;

  select * into v_state
  from atlas.resource_operational_state
  where resource_id=new.resource_id
  for update;

  select coalesce(r.metadata->>'quantity_governed','false')='true',
         coalesce(r.metadata->>'quantity_establishes_readiness','false')='true'
  into v_quantity_governed,v_quantity_establishes_readiness
  from atlas.resources r where r.id=new.resource_id;

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
    if new.event_kind='depleted' and v_quantity_state='known' then v_quantity:=0; end if;
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
      unit=v_unit,last_event_id=new.id,last_observed_at=new.observed_at,
      state_reason=jsonb_build_object(
        'source','resource_event','eventId',new.id,'eventKind',new.event_kind,
        'sourceTaskId',new.source_task_id,'sourceKind',new.source_kind,'sourceId',new.source_id
      ),updated_at=now()
  where resource_id=new.resource_id;

  v_legacy_status:=case
    when v_quantity_governed and v_quantity_state='known' and coalesce(v_quantity,0)=0 then 'needs_purchase'
    when v_quantity_governed and v_quantity_state='known' and coalesce(v_quantity,0)>0 then 'available'
    when v_quantity_governed and v_quantity_state<>'known' then 'unknown'
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
        'operational_readiness_state',v_readiness,
        'operational_quantity_state',v_quantity_state
      ),updated_at=now()
  where id=new.resource_id
    and coalesce(metadata->>'generic_event_state_enabled','false')='true';

  return new;
end;
$function$;

create or replace function atlas.resource_inventory_position_v1(p_resource_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_resource atlas.resources%rowtype;
  v_state atlas.resource_operational_state%rowtype;
  v_policy atlas.resource_stock_policies%rowtype;
  v_committed_quantity numeric := 0;
  v_unquantified_committed integer := 0;
  v_check_first integer := 0;
  v_unit_mismatch integer := 0;
  v_projected numeric;
  v_action text;
  v_acquire numeric;
  v_unit text;
begin
  select * into v_resource from atlas.resources where id=p_resource_id;
  if v_resource.id is null then return jsonb_build_object('state','resource_missing','resourceId',p_resource_id); end if;
  if coalesce(v_resource.metadata->>'quantity_governed','false')<>'true' then
    return jsonb_build_object('state','not_quantity_governed','resourceId',v_resource.id,'resourceKey',v_resource.stable_key);
  end if;

  select * into v_state from atlas.resource_operational_state where resource_id=v_resource.id;
  select * into v_policy from atlas.resource_stock_policies where resource_id=v_resource.id;
  v_unit:=coalesce(v_state.unit,v_resource.unit,v_policy.unit);

  select
    coalesce(sum(r.quantity_needed) filter (
      where r.requirement_role in ('consumed','required','reserved')
        and r.quantity_needed is not null
        and (r.unit is null or v_unit is null or lower(btrim(r.unit))=lower(btrim(v_unit)))
    ),0),
    count(*) filter (
      where r.requirement_role in ('consumed','required','reserved') and r.quantity_needed is null
    )::integer,
    count(*) filter (where r.requirement_role='check_first')::integer,
    count(*) filter (
      where r.requirement_role in ('consumed','required','reserved')
        and r.quantity_needed is not null and r.unit is not null and v_unit is not null
        and lower(btrim(r.unit))<>lower(btrim(v_unit))
    )::integer
  into v_committed_quantity,v_unquantified_committed,v_check_first,v_unit_mismatch
  from atlas.task_resource_requirements r
  join atlas.tasks t on t.id=r.task_id
  where r.resource_id=v_resource.id
    and t.status in ('open','blocked')
    and r.status not in ('used','skipped');

  if v_state.resource_id is null or v_state.quantity_state<>'known' then
    v_action:='count_required';
    v_projected:=null;
  else
    v_projected:=v_state.known_quantity-v_committed_quantity;
    if v_unit_mismatch>0 or v_unquantified_committed>0 then
      v_action:='requirement_quantity_required';
    elsif v_policy.resource_id is null or v_policy.stock_floor is null then
      v_action:='known_no_stock_policy';
    elsif v_projected<v_policy.stock_floor then
      v_action:='restock_required';
      v_acquire:=greatest(coalesce(v_policy.stock_target,v_policy.stock_floor)-v_projected,0);
    else
      v_action:='sufficient';
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','resource_inventory_position_v2',
    'state',v_action,'resourceId',v_resource.id,'resourceKey',v_resource.stable_key,'label',v_resource.label,
    'unit',v_unit,'quantityState',coalesce(v_state.quantity_state,'unknown'),'knownOnHand',v_state.known_quantity,
    'committedRequirementQuantity',v_committed_quantity,
    'unquantifiedCommittedRequirementCount',v_unquantified_committed,
    'unitMismatchRequirementCount',v_unit_mismatch,
    'checkFirstRequirementCount',v_check_first,
    'projectedRemainder',v_projected,'stockFloor',v_policy.stock_floor,'stockTarget',v_policy.stock_target,
    'policyConfigured',(v_policy.resource_id is not null and v_policy.stock_floor is not null),
    'suggestedAcquireQuantity',v_acquire,
    'epistemicClass',case when v_state.resource_id is null or v_state.quantity_state<>'known' or v_unquantified_committed>0 or v_unit_mismatch>0 then 'unresolved' else 'established' end,
    'truthBoundary',jsonb_build_object(
      'unknownIsNotZero',true,'physicalInventoryIsNotCommittedDemand',true,
      'requirementIsNotConsumptionUntilResult',true,'stockPolicyIsNotDemand',true
    )
  ));
end;
$function$;

create or replace function atlas.generic_resource_stock_position_v1(p_resource_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
  select atlas.resource_inventory_position_v1(p_resource_id)
    || jsonb_build_object('compatibilityAlias','generic_resource_stock_position_v1','canonicalFunction','atlas.resource_inventory_position_v1');
$function$;

revoke all on function atlas.generic_resource_stock_position_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.generic_resource_stock_position_v1(uuid) to service_role;

create or replace function atlas.sync_quantity_governed_resource_summary_v1(p_resource_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_resource atlas.resources%rowtype;
  v_position jsonb;
  v_state text;
  v_status text;
begin
  select * into v_resource from atlas.resources where id=p_resource_id;
  if v_resource.id is null or coalesce(v_resource.metadata->>'quantity_governed','false')<>'true' then
    return jsonb_build_object('state','not_applicable','resourceId',p_resource_id);
  end if;
  v_position:=atlas.resource_inventory_position_v1(v_resource.id);
  v_state:=v_position->>'state';
  v_status:=case
    when v_state='restock_required' then 'needs_purchase'
    when v_state in ('requirement_quantity_required','count_required') then 'needs_check'
    when v_state in ('sufficient','known_no_stock_policy') then 'available'
    else v_resource.status
  end;
  update atlas.resources
  set restock_needed=(v_state='restock_required'),status=v_status,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'inventory_position_state',v_state,'inventory_position_contract',v_position->>'contractVersion','inventory_position_evaluated_at',now()
      ),updated_at=now()
  where id=v_resource.id;
  return v_position;
end;
$function$;

revoke all on function atlas.sync_quantity_governed_resource_summary_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.sync_quantity_governed_resource_summary_v1(uuid) to service_role;

create or replace function atlas.refresh_quantity_governed_resource_from_state_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  perform atlas.sync_quantity_governed_resource_summary_v1(new.resource_id);
  return new;
exception when others then return new;
end;
$function$;

revoke all on function atlas.refresh_quantity_governed_resource_from_state_v1() from public,anon,authenticated;
grant execute on function atlas.refresh_quantity_governed_resource_from_state_v1() to service_role;

drop trigger if exists resource_operational_state_inventory_summary_or5_v2 on atlas.resource_operational_state;
create trigger resource_operational_state_inventory_summary_or5_v2
after insert or update of quantity_state,known_quantity,unit on atlas.resource_operational_state
for each row execute function atlas.refresh_quantity_governed_resource_from_state_v1();

create or replace function atlas.refresh_quantity_governed_resource_from_requirement_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare v_resource_id uuid:=coalesce(new.resource_id,old.resource_id);
begin
  if v_resource_id is not null then perform atlas.sync_quantity_governed_resource_summary_v1(v_resource_id); end if;
  return coalesce(new,old);
exception when others then return coalesce(new,old);
end;
$function$;

revoke all on function atlas.refresh_quantity_governed_resource_from_requirement_v1() from public,anon,authenticated;
grant execute on function atlas.refresh_quantity_governed_resource_from_requirement_v1() to service_role;

drop trigger if exists task_resource_requirement_inventory_summary_or5_v2 on atlas.task_resource_requirements;
create trigger task_resource_requirement_inventory_summary_or5_v2
after insert or update of resource_id,requirement_role,quantity_needed,unit,status or delete on atlas.task_resource_requirements
for each row execute function atlas.refresh_quantity_governed_resource_from_requirement_v1();

create or replace function atlas.refresh_quantity_governed_resource_from_policy_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare v_resource_id uuid:=coalesce(new.resource_id,old.resource_id);
begin
  if v_resource_id is not null then perform atlas.sync_quantity_governed_resource_summary_v1(v_resource_id); end if;
  return coalesce(new,old);
exception when others then return coalesce(new,old);
end;
$function$;

revoke all on function atlas.refresh_quantity_governed_resource_from_policy_v1() from public,anon,authenticated;
grant execute on function atlas.refresh_quantity_governed_resource_from_policy_v1() to service_role;

drop trigger if exists resource_stock_policy_inventory_summary_or5_v2 on atlas.resource_stock_policies;
create trigger resource_stock_policy_inventory_summary_or5_v2
after insert or update or delete on atlas.resource_stock_policies
for each row execute function atlas.refresh_quantity_governed_resource_from_policy_v1();

create or replace function atlas.apply_declared_consumed_resource_effects_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_req record;
  v_state atlas.resource_operational_state%rowtype;
  v_status text;
  v_key text;
begin
  if new.transition='reopened' then
    for v_req in
      select r.id,r.resource_id
      from atlas.task_resource_requirements r
      where r.task_id=new.task_id and r.requirement_role='consumed' and r.status='used'
    loop
      select * into v_state from atlas.resource_operational_state where resource_id=v_req.resource_id;
      v_status:=case
        when atlas.resource_requirement_ready_v1(v_req.id) then 'available'
        when v_state.resource_id is null or v_state.quantity_state='unknown' or v_state.readiness_state='unknown' then 'needs_check'
        else 'needed'
      end;
      update atlas.task_resource_requirements set status=v_status,updated_at=now() where id=v_req.id;
    end loop;
    return new;
  end if;

  if new.transition<>'done' then return new; end if;

  for v_req in
    select r.*
    from atlas.task_resource_requirements r
    join atlas.resources res on res.id=r.resource_id
    where r.task_id=new.task_id
      and r.requirement_role='consumed'
      and r.status not in ('used','skipped')
      and coalesce(res.metadata->>'generic_event_state_enabled','false')='true'
  loop
    begin
      v_key:='or5:task-consume:'||new.id::text||':'||v_req.id::text;
      perform atlas.record_resource_event_v1(
        v_req.resource_id,'consumed',v_key,new.task_id,'task_transition',new.id,
        new.actor_membership_id,null,
        case when v_req.quantity_needed is null then null else -v_req.quantity_needed end,
        v_req.unit,new.note,
        jsonb_build_object(
          'contractVersion','apply_declared_consumed_resource_effects_v1',
          'taskTransitionId',new.id,'requirementId',v_req.id,
          'effectOrigin','declared_consumed_resource_requirement',
          'truthBoundary','Task completion remains the human result; this event reconciles only the declared generic resource effect.'
        )
      );
      update atlas.task_resource_requirements set status='used',updated_at=now() where id=v_req.id;
    exception when others then
      begin
        insert into atlas.workflow_events(
          farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload
        ) values(
          new.farm_id,'or5:resource-effect-reconciliation:'||new.id::text||':'||v_req.id::text,
          'task',new.task_id,v_req.id::text,'generic_resource_reconciliation_required',
          (new.created_at at time zone 'America/Chicago')::date,
          jsonb_build_object(
            'contractVersion','apply_declared_consumed_resource_effects_v1','reason','declared_resource_effect_failed','error',sqlerrm,
            'taskTransitionId',new.id,'requirementId',v_req.id,'resourceId',v_req.resource_id,
            'principle','The human completion remains true; the generic resource effect must be reconciled separately.'
          )
        ) on conflict (farm_id,event_key) do nothing;
      exception when others then null;
      end;
    end;
  end loop;
  return new;
end;
$function$;

revoke all on function atlas.apply_declared_consumed_resource_effects_v1() from public,anon,authenticated;
grant execute on function atlas.apply_declared_consumed_resource_effects_v1() to service_role;

drop trigger if exists task_transition_generic_resource_effects_or5_v1 on atlas.task_transitions;
create trigger task_transition_generic_resource_effects_or5_v1
after insert on atlas.task_transitions
for each row execute function atlas.apply_declared_consumed_resource_effects_v1();

select atlas.sync_quantity_governed_resource_summary_v1(r.id)
from atlas.resources r join atlas.farms f on f.id=r.farm_id
where f.stable_key='elm_farm' and r.stable_key='venue_clear_cold_cups';