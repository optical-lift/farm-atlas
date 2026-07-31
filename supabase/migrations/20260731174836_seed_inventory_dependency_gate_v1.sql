-- Trusted seed-count coverage for production sowing and one Owner shortfall decision.

create or replace function atlas.link_seed_lot_metadata_task_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare v_seed_lot_id uuid;v_role text;
begin
  v_seed_lot_id:=atlas.rhythm_safe_uuid_v1(new.metadata->>'seed_lot_id');
  if v_seed_lot_id is null then return new; end if;
  if not exists(select 1 from atlas.seed_lots sl where sl.id=v_seed_lot_id and sl.farm_id=new.farm_id) then return new; end if;
  v_role:=case
    when new.task_type='seed_inventory_decision' then 'inventory_purchase_decision'
    when new.task_type='seed_inventory_recount' and new.status='blocked' then 'inventory_problem'
    else 'inventory_recount' end;
  insert into atlas.seed_lot_task_links(seed_lot_id,task_id,link_role,source,metadata)
  values(v_seed_lot_id,new.id,v_role,'task_metadata_v1',jsonb_build_object('task_type',new.task_type,'task_style',new.metadata->>'task_style'))
  on conflict(seed_lot_id,task_id) do update set
    link_role=excluded.link_role,source=excluded.source,
    metadata=atlas.seed_lot_task_links.metadata||excluded.metadata,updated_at=now();
  return new;
end;
$$;

drop trigger if exists tasks_link_seed_lot_metadata_v1 on atlas.tasks;
create trigger tasks_link_seed_lot_metadata_v1
after insert or update of metadata,task_type,status on atlas.tasks
for each row execute function atlas.link_seed_lot_metadata_task_v1();

create or replace function atlas.sync_seed_inventory_dependency_tasks_v1(p_seed_lot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_lot atlas.seed_lots%rowtype;
  v_position atlas.seed_inventory_position_v1%rowtype;
  v_owner atlas.farm_memberships%rowtype;
  v_shortfall numeric:=0;
  v_uncovered_count integer:=0;
  v_dependency_labels text;
  v_dependency_ids jsonb:='[]'::jsonb;
  v_occurrence_id uuid;
  v_source_event_id uuid;
  v_signal jsonb;
  v_existing_task record;
  v_transition jsonb;
begin
  select * into v_lot from atlas.seed_lots where id=p_seed_lot_id;
  if v_lot.id is null then raise exception 'Seed lot was not found.' using errcode='P0002'; end if;
  select * into v_position from atlas.seed_inventory_position_v1 where seed_lot_id=v_lot.id;
  select * into v_owner from atlas.farm_memberships
  where farm_id=v_lot.farm_id and role='owner' and active order by created_at limit 1;

  if coalesce(v_position.count_trusted,false) then
    select
      greatest(coalesce(sum(outstanding_quantity),0)-coalesce(v_position.projected_on_hand_quantity,0),0),
      count(*) filter (where not covered_by_trusted_inventory),
      string_agg(production_lot_label,' · ' order by planned_sow_date nulls last),
      coalesce(jsonb_agg(jsonb_build_object(
        'productionLotId',production_lot_id,'label',production_lot_label,
        'plannedSowDate',planned_sow_date,'outstandingQuantity',outstanding_quantity,
        'covered',covered_by_trusted_inventory
      ) order by planned_sow_date nulls last),'[]'::jsonb)
    into v_shortfall,v_uncovered_count,v_dependency_labels,v_dependency_ids
    from atlas.seed_allocation_coverage_v1
    where seed_lot_id=v_lot.id;
  end if;

  if not coalesce(v_position.count_trusted,false) or v_shortfall<=0 then
    for v_existing_task in
      select t.id
      from atlas.seed_lot_task_links stl join atlas.tasks t on t.id=stl.task_id
      where stl.seed_lot_id=v_lot.id and stl.link_role='inventory_purchase_decision'
        and t.status in ('open','blocked')
    loop
      v_transition:=atlas.record_task_transition_v1_internal(
        v_existing_task.id,'changed_plan',
        left('seed-inventory-shortfall-resolved:'||v_lot.id::text||':'||v_existing_task.id::text||':'||extract(epoch from now())::bigint::text,160),
        null,
        case when coalesce(v_position.count_trusted,false)
          then 'Verified inventory now covers the committed production lots.'
          else 'Inventory count is no longer trusted; purchase decision withdrawn until a physical recount.' end,
        'Seed shortfall decision is no longer actionable.','seed_inventory','shortfall_resolved',
        jsonb_build_object('seed_lot_id',v_lot.id,'count_trusted',coalesce(v_position.count_trusted,false)),null
      );
    end loop;
    return jsonb_build_object('seedLotId',v_lot.id,'countTrusted',coalesce(v_position.count_trusted,false),'shortfall',v_shortfall,'action','no_open_shortfall');
  end if;

  if v_owner.id is null then
    return jsonb_build_object('seedLotId',v_lot.id,'countTrusted',true,'shortfall',v_shortfall,'action','owner_membership_missing');
  end if;

  select source_event_id into v_source_event_id from atlas.seed_inventory_state where seed_lot_id=v_lot.id;
  v_occurrence_id:=atlas.plan_work_occurrence_v1(
    p_farm_id=>v_lot.farm_id,
    p_definition_key=>'seed-inventory-shortfall-'||v_lot.stable_key,
    p_policy_key=>'seed-inventory-shortfall-'||v_lot.stable_key,
    p_occurrence_key=>'seed-shortfall:'||v_lot.id::text||':'||coalesce(v_source_event_id::text,'no-event'),
    p_title=>'Resolve seed shortfall — '||v_lot.lot_label,
    p_task_type=>'seed_inventory_decision',
    p_due_date=>(now() at time zone 'America/Chicago')::date,
    p_source_kind=>'seed_lot',
    p_source_id=>v_lot.id,
    p_gate_type=>'serial_queue',
    p_horizon_days=>30,
    p_maximum_active_instances=>1,
    p_task_payload=>jsonb_build_object(
      'farm_id',v_lot.farm_id,'title','Resolve seed shortfall — '||v_lot.lot_label,
      'task_type','seed_inventory_decision','status','open','priority','high',
      'generated_from','seed_inventory_freshness','generated_from_id',v_lot.id,
      'action_key','resolve_seed_shortfall','work_class','owner_decision',
      'visibility_scope','assigned_worker','assigned_membership_id',v_owner.id,
      'note','A trusted physical count does not cover all committed production lots. Decide whether to restock, reduce, release, or substitute allocations.',
      'metadata',jsonb_build_object(
        'task_style','seed_inventory_decision','structured_result_required',false,
        'seed_lot_id',v_lot.id,'seed_lot_key',v_lot.stable_key,'seed_lot_label',v_lot.lot_label,
        'shortfall_quantity',v_shortfall,'quantity_unit',v_lot.quantity_unit,
        'uncovered_dependency_count',v_uncovered_count,'dependencies',v_dependency_ids,
        'display_action','Resolve seed shortfall','display_subject',v_lot.lot_label,
        'display_detail',v_shortfall::text||' '||v_lot.quantity_unit||' short across committed production lots',
        'collection_zone','Seed inventory','assignee_key','owner','owner_task',true,
        'time_claims_inventory_quantity',false
      )
    ),
    p_relation_payload=>'{}'::jsonb,
    p_gate_config=>jsonb_build_object('source','trusted_seed_inventory_shortfall'),
    p_not_before_date=>(now() at time zone 'America/Chicago')::date,
    p_metadata=>jsonb_build_object('seedLotId',v_lot.id,'shortfall',v_shortfall,'sourceEventId',v_source_event_id)
  );
  v_signal:=atlas.signal_work_occurrence_v1(v_occurrence_id,'seed_inventory:verified_shortfall',jsonb_build_object(
    'seed_lot_id',v_lot.id,'shortfall',v_shortfall,'dependencies',v_dependency_ids
  ));

  return jsonb_build_object(
    'seedLotId',v_lot.id,'countTrusted',true,'shortfall',v_shortfall,
    'dependencyCount',v_uncovered_count,'dependencyLabels',v_dependency_labels,
    'occurrenceId',v_occurrence_id,'signal',v_signal,'action','shortfall_decision_planned'
  );
end;
$$;

create or replace function atlas.assert_production_seed_ready_v1(p_production_lot_id uuid,p_required_quantity numeric)
returns void
language plpgsql
stable security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_ready boolean;
  v_covered numeric;
  v_allocated numeric;
  v_reason text;
begin
  if p_production_lot_id is null or p_required_quantity is null or p_required_quantity<=0 then
    raise exception 'Production lot and positive seed quantity are required.' using errcode='22023';
  end if;
  select coalesce(all_seed_allocations_ready,false),coalesce(trusted_covered_quantity,0),
    coalesce(outstanding_allocated_quantity,0),blocking_reason
  into v_ready,v_covered,v_allocated,v_reason
  from atlas.production_seed_readiness_v1 where production_lot_id=p_production_lot_id;
  if v_allocated<p_required_quantity then
    raise exception 'Seed allocations do not cover the requested sowing quantity.' using errcode='22023';
  end if;
  if not v_ready or v_covered<p_required_quantity then
    raise exception 'A current verified physical seed count is required before sowing: %',coalesce(v_reason,'trusted inventory does not cover this production lot') using errcode='22023';
  end if;
end;
$$;

create or replace function atlas.validate_seed_lot_allocation_v1()
returns trigger
language plpgsql
security definer
set search_path=atlas,pg_temp
as $$
declare
  v_seed_farm uuid;v_seed_profile uuid;v_received numeric;v_seed_unit text;
  v_lot_farm uuid;v_lot_profile uuid;v_existing numeric;
  v_governed boolean:=false;v_trusted boolean:=false;v_projected numeric;
begin
  select farm_id,crop_profile_id,received_quantity,quantity_unit
  into v_seed_farm,v_seed_profile,v_received,v_seed_unit
  from atlas.seed_lots where id=new.seed_lot_id;
  select farm_id,crop_profile_id into v_lot_farm,v_lot_profile
  from atlas.production_lots where id=new.production_lot_id;
  if v_seed_farm is null or v_lot_farm is null or v_seed_farm<>v_lot_farm then raise exception 'Seed lot and production lot must belong to the same farm'; end if;
  if v_seed_profile is not null and v_lot_profile is not null and v_seed_profile<>v_lot_profile then raise exception 'Seed lot and production lot crop profiles must match'; end if;
  if lower(btrim(new.unit))<>lower(btrim(v_seed_unit)) then raise exception 'Allocation unit must match the seed lot unit'; end if;

  select exists(select 1 from atlas.seed_inventory_state sis where sis.seed_lot_id=new.seed_lot_id and coalesce(sis.metadata->>'governed','false')='true')
  into v_governed;
  if v_governed then
    select coalesce(count_trusted,false),projected_on_hand_quantity into v_trusted,v_projected
    from atlas.seed_inventory_position_v1 where seed_lot_id=new.seed_lot_id;
    if new.allocation_status in ('reserved','consumed') and not v_trusted then
      raise exception 'A current verified physical seed count is required before reserving this seed lot.';
    end if;
    select coalesce(sum(allocated_quantity),0) into v_existing
    from atlas.seed_lot_allocations
    where seed_lot_id=new.seed_lot_id and allocation_status in ('reserved','consumed') and id<>new.id;
    if new.allocation_status in ('reserved','consumed') and v_existing+new.allocated_quantity>coalesce(v_projected,0) then
      raise exception 'Seed allocation exceeds current verified on-hand inventory.';
    end if;
  else
    select coalesce(sum(allocated_quantity),0) into v_existing
    from atlas.seed_lot_allocations
    where seed_lot_id=new.seed_lot_id and allocation_status in ('reserved','consumed') and id<>new.id;
    if new.allocation_status in ('reserved','consumed') and v_existing+new.allocated_quantity>v_received then
      raise exception 'Seed allocation exceeds received inventory';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='record_production_sowing_v1';
  if v_definition not like '%assert_production_seed_ready_v1%' then
    v_definition:=replace(
      v_definition,
      '  select coalesce(sum(sla.allocated_quantity-coalesce(used.quantity_used,0)),0) into v_available',
      '  perform atlas.assert_production_seed_ready_v1(v_lot.id,p_seed_quantity);'||E'\n\n'||
      '  select coalesce(sum(sla.allocated_quantity-coalesce(used.quantity_used,0)),0) into v_available'
    );
    execute v_definition;
  end if;
end;
$$;

create or replace function atlas.task_has_authoritative_history_v1(p_task_id uuid)
returns boolean
language sql
stable security definer
set search_path=pg_catalog,atlas
as $$
select exists(select 1 from atlas.task_outcome_events x where x.task_id=p_task_id)
 or exists(select 1 from atlas.task_transitions x where x.task_id=p_task_id)
 or exists(select 1 from atlas.maintenance_history x where x.source_task_id=p_task_id)
 or exists(select 1 from atlas.production_tray_batches x where x.source_task_id=p_task_id)
 or exists(select 1 from atlas.seed_allocation_consumptions x where x.source_task_id=p_task_id)
 or exists(select 1 from atlas.seed_inventory_events x where x.task_id=p_task_id)
 or exists(select 1 from atlas.production_stage_observations x where x.task_id=p_task_id)
 or exists(select 1 from atlas.production_transplant_placements x where x.source_task_id=p_task_id)
 or exists(select 1 from atlas.production_readiness_observations x where x.task_id=p_task_id)
 or exists(select 1 from atlas.production_field_observations x where x.task_id=p_task_id)
 or exists(select 1 from atlas.production_harvest_lots x where x.source_task_id=p_task_id)
 or exists(select 1 from atlas.production_lot_events x where x.task_id=p_task_id)
 or exists(select 1 from atlas.postharvest_container_events x where x.task_id=p_task_id);
$$;