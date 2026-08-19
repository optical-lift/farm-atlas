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
      'resourceStatus',v_resource.status,
      'resourceRole',v_resource.metadata->>'resource_role',
      'quantityGoverned',v_quantity_governed,
      'readinessState',v_resource_state.readiness_state,
      'quantityState',v_resource_state.quantity_state,
      'knownQuantity',v_resource_state.known_quantity,
      'unit',coalesce(v_resource_state.unit,v_resource.unit),
      'inventoryState',case when v_quantity_governed then v_inventory->>'state' else null end,
      'inventoryPosition',case when v_quantity_governed then v_inventory else null end,
      'statusReason',coalesce(v_resource.metadata->>'unavailable_reason',v_resource.metadata->>'status_reason')
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

insert into atlas.state_consequence_policies(
  stable_key,subject_kind,subject_selector,state_match,consequence_kind,action_key,audience,priority,action_spec,metadata
) values (
  'resource-status-needs-repair','resource','{}'::jsonb,jsonb_build_object('resourceStatus','needs_repair'),
  'repair_resolution','resolve_resource_repair','farm_operations_management',5,
  jsonb_build_object('state','repair_required','action','resolve_resource_repair','actionLabel','Resolve repair','promptMode','resource_repair'),
  jsonb_build_object(
    'contract','operation_result_or6',
    'truthBoundary','legacy_resource_status_is_canonical_when_no_stronger_operational_state_exists',
    'principalBoundary','repair_stays_operations_until_authority_capital_or_repeated_failure_crosses_escalation_policy'
  )
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

create or replace function atlas.reconcile_resource_identity_consequences_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
begin
  perform atlas.reconcile_state_consequences_v1('resource',case when tg_op='DELETE' then old.id else new.id end);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists or6_reconcile_resource_identity on atlas.resources;
create trigger or6_reconcile_resource_identity
after insert or update of status, metadata on atlas.resources
for each row execute function atlas.reconcile_resource_identity_consequences_trigger_v1();

do $$
declare v record;
begin
  for v in select id from atlas.resources loop
    perform atlas.reconcile_state_consequences_v1('resource',v.id);
  end loop;
end $$;