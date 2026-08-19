create or replace function atlas.harvest_inventory_reality_expression_v1(
  p_ready_lot_id uuid
)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_prep atlas.flower_preparation_batches%rowtype;
  v_harvest atlas.flower_harvest_batches%rowtype;
  v_position record;
  v_state record;
  v_inputs jsonb := '[]'::jsonb;
  v_demand_claims jsonb := '[]'::jsonb;
  v_sale_claims jsonb := '[]'::jsonb;
  v_prospect_claims jsonb := '[]'::jsonb;
  v_fulfillment jsonb := '[]'::jsonb;
  v_dispositions jsonb := '[]'::jsonb;
  v_balance jsonb := null;
  v_input_count integer := 0;
  v_field_ready_count integer := 0;
  v_current_physical numeric := 0;
  v_sold_committed numeric := 0;
  v_current_claimed numeric := 0;
  v_custody_accounted numeric := 0;
  v_custody_reconciles boolean := false;
  v_lifecycle_state text;
  v_availability_state text;
  v_issues jsonb := '[]'::jsonb;
begin
  if p_ready_lot_id is null then
    raise exception 'A Ready inventory lot is required.' using errcode='22023';
  end if;

  select * into v_ready
  from atlas.flower_ready_inventory_lots
  where id=p_ready_lot_id;

  if v_ready.id is null then
    raise exception 'Ready inventory lot was not found.' using errcode='P0002';
  end if;

  select * into v_position
  from atlas.flower_ready_inventory_position_v1
  where id=v_ready.id;

  select * into v_state
  from atlas.flower_ready_inventory_state_v1
  where ready_lot_id=v_ready.id;

  select * into v_prep
  from atlas.flower_preparation_batches
  where id=v_ready.preparation_batch_id;

  if v_prep.id is not null then
    select * into v_harvest
    from atlas.flower_harvest_batches
    where id=v_prep.harvest_batch_id;
  end if;

  select
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'preparationInputId',pi.id,
      'harvestObservationId',o.id,
      'cropCycleId',o.crop_cycle_id,
      'cropLabel',cc.crop_label,
      'variety',cc.variety,
      'harvestTaskId',o.task_id,
      'harvestObservedDate',o.observed_date,
      'harvestQuantityFloor',o.bucket_equivalent_floor,
      'harvestUnit','bucket_equivalent',
      'harvestQuantityExactness',case when o.bucket_band='more_than_one' then 'lower_bound' else 'band_floor' end,
      'moreAvailable',o.more_available,
      'fieldReadinessAtRead',case when ha.crop_cycle_id is null then null else jsonb_build_object(
        'status',ha.status,
        'estimatedQuantity',ha.estimated_quantity,
        'unit',ha.unit,
        'observedDate',ha.observed_date,
        'sourceEventId',ha.source_event_id,
        'updatedAt',ha.updated_at
      ) end,
      'sourceCycleCurrentState',cc.cycle_state,
      'sourceCycleCurrentLifecycleStatus',cc.lifecycle_status
    )) order by o.observed_date,o.id),'[]'::jsonb),
    count(*)::integer,
    count(*) filter (where ha.status in ('ready','open','available','harvest_ready'))::integer
  into v_inputs,v_input_count,v_field_ready_count
  from atlas.flower_preparation_inputs pi
  join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id
  join atlas.crop_cycles cc on cc.id=o.crop_cycle_id
  left join atlas.crop_harvest_availability ha on ha.crop_cycle_id=o.crop_cycle_id
  where pi.preparation_batch_id=v_ready.preparation_batch_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'claimType','customer_or_event_demand',
      'claimSource','flower_demand_allocation',
      'allocationId',a.id,
      'demandOrderId',d.id,
      'demandLineId',dl.id,
      'claimSubject',v_ready.id,
      'claimedQuantity',a.quantity,
      'unit',dl.unit,
      'intendedDestination',coalesce(d.customer_label,d.sales_channel),
      'requiredBy',d.requested_for_date,
      'claimStrength',d.demand_strength,
      'displacementAuthority',case when d.demand_strength='committed' then 'management_or_explicit_cancellation' else 'Farm Operations' end,
      'protectionReason',case when d.demand_strength='committed' then 'committed customer or event demand' else 'requested demand' end,
      'status','active_reserved',
      'salesChannel',d.sales_channel,
      'sourceEvidence',jsonb_build_object('demandOrderId',d.id,'demandLineId',dl.id,'allocationId',a.id)
    ) order by d.requested_for_date,d.id,a.id),'[]'::jsonb)
  into v_demand_claims
  from atlas.flower_demand_allocations a
  join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id
  join atlas.flower_demand_orders d on d.id=dl.demand_order_id
  where a.ready_lot_id=v_ready.id
    and not exists (select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id)
    and not exists (select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id)
    and not exists (select 1 from atlas.flower_demand_order_cancellation_events dc where dc.demand_order_id=d.id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'claimType',case when s.event_key is null then 'customer_sale_commitment' else 'event_sale_commitment' end,
      'claimSource','flower_sale_order_line',
      'saleOrderId',s.id,
      'saleLineId',sl.id,
      'claimSubject',v_ready.id,
      'claimedQuantity',sl.quantity,
      'unit',sl.unit,
      'intendedDestination',coalesce(s.customer_label,s.event_key,s.sales_channel),
      'requiredBy',s.fulfillment_due_date,
      'claimStrength','committed',
      'displacementAuthority','management_or_explicit_cancellation',
      'protectionReason','recorded sale commitment awaiting fulfillment',
      'status','sold_committed',
      'salesChannel',s.sales_channel,
      'eventKey',s.event_key,
      'sourceEvidence',jsonb_build_object('saleOrderId',s.id,'saleLineId',sl.id)
    ) order by s.fulfillment_due_date nulls first,s.id,sl.id),'[]'::jsonb)
  into v_sale_claims
  from atlas.flower_sale_order_lines sl
  join atlas.flower_sale_orders s on s.id=sl.sale_order_id
  where sl.ready_lot_id=v_ready.id
    and not exists (select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id)
    and not exists (select 1 from atlas.flower_fulfillment_events f where f.sale_order_id=s.id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'claimType','prospect_route_custody',
      'claimSource','flower_prospect_route_line',
      'prospectRouteId',r.id,
      'prospectRouteLineId',l.id,
      'claimSubject',v_ready.id,
      'claimedQuantity',greatest(l.quantity-coalesce(rel.released_quantity,0),0),
      'unit',v_ready.unit,
      'intendedDestination',coalesce(l.destination_label,r.route_label),
      'requiredBy',r.route_date,
      'claimStrength','planned',
      'displacementAuthority','Farm Operations',
      'protectionReason','inventory physically routed for prospecting',
      'status','on_prospect_route',
      'sourceEvidence',jsonb_build_object('prospectRouteId',r.id,'prospectRouteLineId',l.id)
    ) order by r.route_date,r.id,l.id) filter (where greatest(l.quantity-coalesce(rel.released_quantity,0),0)>0),'[]'::jsonb)
  into v_prospect_claims
  from atlas.flower_prospect_route_lines l
  join atlas.flower_prospect_routes r on r.id=l.prospect_route_id
  left join lateral (
    select sum(e.quantity) as released_quantity
    from atlas.flower_prospect_route_release_events e
    where e.prospect_route_line_id=l.id
  ) rel on true
  where l.ready_lot_id=v_ready.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'fulfillmentEventId',f.id,
      'saleOrderId',s.id,
      'fulfilledQuantity',sl.quantity,
      'unit',sl.unit,
      'customerOrEvent',coalesce(s.customer_label,s.event_key,s.sales_channel),
      'fulfilledAt',f.fulfilled_at,
      'fulfillmentMethod',f.fulfillment_method,
      'sourceEvidence',jsonb_build_object('saleOrderId',s.id,'saleLineId',sl.id,'fulfillmentEventId',f.id)
    ) order by f.fulfilled_at,f.id),'[]'::jsonb)
  into v_fulfillment
  from atlas.flower_sale_order_lines sl
  join atlas.flower_sale_orders s on s.id=sl.sale_order_id
  join atlas.flower_fulfillment_events f on f.sale_order_id=s.id
  where sl.ready_lot_id=v_ready.id
    and not exists (select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'dispositionEventId',e.id,
      'kind',e.disposition_kind,
      'quantity',e.quantity,
      'unit',e.unit,
      'note',e.note,
      'createdAt',e.created_at,
      'sourceEvidence',jsonb_build_object('dispositionEventId',e.id)
    ) order by e.created_at,e.id),'[]'::jsonb)
  into v_dispositions
  from atlas.flower_ready_inventory_disposition_events e
  where e.ready_lot_id=v_ready.id;

  select to_jsonb(b) into v_balance
  from atlas.flower_supply_demand_balance_v1 b
  where b.farm_id=v_ready.farm_id
    and b.inventory_kind=v_ready.inventory_kind
    and b.unit=v_ready.unit
    and b.crop_profile_id is not distinct from v_ready.crop_profile_id
  limit 1;

  v_sold_committed := greatest(coalesce(v_position.active_claimed_quantity,0)-coalesce(v_position.fulfilled_quantity,0),0);
  v_current_physical := greatest(coalesce(v_position.birth_quantity,0)-coalesce(v_position.fulfilled_quantity,0)-coalesce(v_position.disposed_quantity,0),0);
  v_current_claimed := coalesce(v_position.demand_reserved_quantity,0)+v_sold_committed+coalesce(v_position.on_prospect_route_quantity,0);
  v_custody_accounted := coalesce(v_position.available_quantity,0)+v_current_claimed;
  v_custody_reconciles := abs(v_current_physical-v_custody_accounted)<0.0001 and coalesce(v_state.state_reconciles,false);

  v_lifecycle_state := case
    when v_input_count=0 then 'ready_without_harvest_input_gap'
    when v_prep.id is null or v_harvest.id is null then 'ready_lineage_gap'
    when v_prep.result_kind<>'ready' then 'ready_preparation_conflict'
    when v_field_ready_count>0 then 'field_ready_to_harvested_to_processing_to_ready_supported'
    else 'harvested_to_processing_to_ready_supported_field_readiness_not_currently_proven'
  end;

  v_availability_state := case
    when not v_custody_reconciles then 'custody_reconciliation_required'
    when coalesce(v_position.available_quantity,0)<=0 and v_current_physical<=0 then 'no_physical_inventory_remaining'
    when coalesce(v_position.available_quantity,0)<=0 and v_current_claimed>0 then 'fully_claimed'
    when coalesce(v_position.available_quantity,0)>0 and v_current_claimed>0 then 'partially_available_after_claims'
    when coalesce(v_position.available_quantity,0)>0 then 'available_unclaimed'
    else 'not_available'
  end;

  if not v_custody_reconciles then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key','inventory_custody_does_not_reconcile','severity','attention',
      'physicalQuantity',v_current_physical,'accountedPhysicalQuantity',v_custody_accounted
    ));
  end if;
  if v_input_count=0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key','ready_inventory_missing_harvest_lineage','severity','attention'
    ));
  end if;
  if v_ready.quantity_exactness<>'exact' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'key','inventory_quantity_is_lower_bound','severity','context',
      'quantityExactness',v_ready.quantity_exactness
    ));
  end if;

  return jsonb_build_object(
    'contractVersion','harvest_inventory_reality_expression_v1',
    'subject',jsonb_strip_nulls(jsonb_build_object(
      'subjectType','flower_ready_inventory_lot',
      'id',v_ready.id,
      'farmId',v_ready.farm_id,
      'inventoryKind',v_ready.inventory_kind,
      'cropProfileId',v_ready.crop_profile_id,
      'productLabel',v_ready.product_label,
      'unit',v_ready.unit,
      'quantityExactness',v_ready.quantity_exactness,
      'readyDate',v_ready.ready_date
    )),
    'lifecycle',jsonb_build_object(
      'state',v_lifecycle_state,
      'fieldReadyEvidence',jsonb_build_object(
        'supportedInputCount',v_field_ready_count,
        'principle','Field readiness is reported only when the linked crop harvest-availability rail currently carries an explicit ready/open/available state; Harvest itself is not used to back-infer prior readiness.'
      ),
      'harvested',jsonb_strip_nulls(jsonb_build_object(
        'harvestBatchId',v_harvest.id,
        'harvestDate',v_harvest.harvest_date,
        'batchKey',v_harvest.batch_key,
        'inputs',v_inputs
      )),
      'processing',jsonb_strip_nulls(jsonb_build_object(
        'preparationBatchId',v_prep.id,
        'preparedDate',v_prep.prepared_date,
        'resultKind',v_prep.result_kind,
        'sourceHarvestBatchId',v_prep.harvest_batch_id
      )),
      'ready',jsonb_build_object(
        'readyLotId',v_ready.id,
        'readyDate',v_ready.ready_date,
        'birthQuantity',v_position.birth_quantity,
        'unit',v_ready.unit
      )
    ),
    'custody',jsonb_build_object(
      'physicalQuantity',v_current_physical,
      'availableQuantity',v_position.available_quantity,
      'claimedQuantity',v_current_claimed,
      'demandReservedQuantity',v_position.demand_reserved_quantity,
      'soldCommittedQuantity',v_sold_committed,
      'onProspectRouteQuantity',v_position.on_prospect_route_quantity,
      'fulfilledQuantity',v_position.fulfilled_quantity,
      'disposedQuantity',v_position.disposed_quantity,
      'accountedPhysicalQuantity',v_custody_accounted,
      'reconciles',v_custody_reconciles,
      'availabilityState',v_availability_state,
      'principle','Physical existence is separate from availability. Current physical custody equals available plus outstanding demand, sale, and route claims; fulfilled and disposed quantities have left current physical custody.'
    ),
    'claims',jsonb_build_object(
      'demandReservations',v_demand_claims,
      'saleCommitments',v_sale_claims,
      'prospectRouteCustody',v_prospect_claims,
      'activeClaimedQuantity',v_current_claimed,
      'principle','Converted demand allocations are not double-counted after they become sale lines; fulfilled sale lines are no longer active claims.'
    ),
    'movement',jsonb_build_object(
      'fulfillment',v_fulfillment,
      'dispositions',v_dispositions,
      'principle','Fulfillment and disposition are custody exits, not reductions in the historical quantity that was originally prepared.'
    ),
    'revenueDemand',jsonb_build_object(
      'preparedRetailValue',v_position.prepared_retail_value,
      'activeCommittedProductRevenue',v_position.active_committed_product_revenue,
      'realizedProductRevenue',v_position.realized_product_revenue,
      'supplyDemandBalance',v_balance,
      'principle','Revenue and demand are reconciled through native sale, demand, allocation, fulfillment, and Ready inventory rails rather than inferred from physical quantity alone.'
    ),
    'issues',v_issues,
    'truthBoundary',jsonb_build_object(
      'readOnly',true,
      'physicalIsNotAvailable',true,
      'claimRequiresSourceAndDestination',true,
      'fulfilledIsNotCurrentClaim',true,
      'disposedIsNotPhysicalInventory',true,
      'harvestDoesNotBackInferReadiness',true,
      'domainNativeRailsPreserved',true,
      'noGenericClaimTableAdded',true
    )
  );
end;
$function$;

revoke all on function atlas.harvest_inventory_reality_expression_v1(uuid) from public;
revoke all on function atlas.harvest_inventory_reality_expression_v1(uuid) from anon;
revoke all on function atlas.harvest_inventory_reality_expression_v1(uuid) from authenticated;
grant execute on function atlas.harvest_inventory_reality_expression_v1(uuid) to service_role;