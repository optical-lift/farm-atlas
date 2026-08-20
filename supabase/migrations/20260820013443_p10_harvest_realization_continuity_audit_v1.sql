create or replace function atlas.harvest_realization_continuity_audit_v1(p_farm_id uuid default null)
returns table(
  issue_key text,
  severity text,
  farm_id uuid,
  crop_cycle_id uuid,
  subject_id uuid,
  detail jsonb
)
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
  with unprepared as (
    select
      'harvest_output_without_preparation_continuation'::text as issue_key,
      'high'::text as severity,
      o.farm_id,
      o.crop_cycle_id,
      o.id as subject_id,
      jsonb_build_object(
        'harvestObservationId',o.id,
        'harvestBatchId',o.batch_id,
        'observedDate',o.observed_date,
        'bucketBand',o.bucket_band,
        'bucketEquivalentFloor',o.bucket_equivalent_floor,
        'principle','Physical Harvest output must retain a lawful preparation continuation until it is consumed by preparation truth.'
      ) as detail
    from atlas.flower_harvest_bucket_observations o
    where (p_farm_id is null or o.farm_id=p_farm_id)
      and not exists (
        select 1 from atlas.flower_preparation_inputs pi where pi.harvest_observation_id=o.id
      )
      and not exists (
        select 1
        from atlas.planned_work_occurrences pwo
        left join atlas.tasks t on t.id=pwo.released_task_id
        where pwo.farm_id=o.farm_id
          and pwo.source_kind='flower_harvest_batch'
          and pwo.source_id=o.batch_id
          and (pwo.released_task_id is null or t.status in ('open','blocked'))
      )
  ),
  commercial_gap as (
    select
      'commercial_target_gap_without_owner_continuation'::text as issue_key,
      'high'::text as severity,
      i.farm_id,
      i.subject_id as crop_cycle_id,
      i.id as subject_id,
      jsonb_build_object(
        'truthAcquisitionInstanceId',i.id,
        'sourceRequirementInstanceId',i.source_requirement_instance_id,
        'carrierTaskId',i.carrier_task_id,
        'actionKey',i.action_key,
        'principle','Buyer/channel uncertainty may not block biological Harvest, but an open Owner-jurisdiction commercial truth gap must retain a lawful human carrier.'
      ) as detail
    from atlas.state_consequence_instances i
    where (p_farm_id is null or i.farm_id=p_farm_id)
      and i.status='open'
      and i.subject_kind='crop_cycle'
      and i.consequence_role='truth_acquisition'
      and i.action_key='choose_harvest_disposition'
      and not exists (
        select 1 from atlas.tasks t
        where t.id=i.carrier_task_id and t.status in ('open','blocked')
      )
      and not exists (
        select 1
        from atlas.planned_work_occurrences pwo
        left join atlas.tasks t on t.id=pwo.released_task_id
        where pwo.farm_id=i.farm_id
          and pwo.source_kind='state_consequence_truth_acquisition'
          and pwo.source_id=i.id
          and (pwo.released_task_id is null or t.status in ('open','blocked'))
      )
  ),
  lineage_gap as (
    select
      'ready_inventory_missing_harvest_lineage'::text as issue_key,
      'high'::text as severity,
      r.farm_id,
      null::uuid as crop_cycle_id,
      r.id as subject_id,
      jsonb_build_object(
        'readyLotId',r.id,
        'preparationBatchId',r.preparation_batch_id,
        'inventoryKind',r.inventory_kind,
        'quantity',r.quantity,
        'unit',r.unit,
        'principle','Ready inventory cannot become source truth unless its preparation preserves at least one attributable physical Harvest input.'
      ) as detail
    from atlas.flower_ready_inventory_lots r
    where (p_farm_id is null or r.farm_id=p_farm_id)
      and not exists (
        select 1
        from atlas.flower_preparation_inputs pi
        join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id
        where pi.preparation_batch_id=r.preparation_batch_id
      )
  ),
  fulfillment_gap as (
    select
      'sale_commitment_without_fulfillment_continuation'::text as issue_key,
      'high'::text as severity,
      s.farm_id,
      null::uuid as crop_cycle_id,
      s.id as subject_id,
      jsonb_build_object(
        'saleOrderId',s.id,
        'customerLabel',s.customer_label,
        'salesChannel',s.sales_channel,
        'fulfillmentMode',s.fulfillment_mode,
        'fulfillmentDueDate',s.fulfillment_due_date,
        'principle','A noncancelled scheduled sale is a commitment, not realized result; it must retain lawful fulfillment continuation until actual handoff is recorded.'
      ) as detail
    from atlas.flower_sale_orders s
    where (p_farm_id is null or s.farm_id=p_farm_id)
      and s.fulfillment_mode<>'immediate_handoff'
      and not exists (select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id)
      and not exists (select 1 from atlas.flower_fulfillment_events f where f.sale_order_id=s.id)
      and not exists (
        select 1 from atlas.tasks t
        where t.farm_id=s.farm_id
          and t.task_type='flower_fulfillment'
          and t.status in ('open','blocked')
          and t.metadata->>'flower_sale_order_id'=s.id::text
      )
      and not exists (
        select 1
        from atlas.planned_work_occurrences pwo
        left join atlas.tasks t on t.id=pwo.released_task_id
        where pwo.farm_id=s.farm_id
          and pwo.source_kind='flower_sale_order'
          and pwo.source_id=s.id
          and (pwo.released_task_id is null or t.status in ('open','blocked'))
      )
  ),
  mixed_sale_context as (
    select distinct
      'mixed_crop_ready_sale_revenue_attribution_withheld'::text as issue_key,
      'context'::text as severity,
      r.farm_id,
      null::uuid as crop_cycle_id,
      r.id as subject_id,
      jsonb_build_object(
        'readyLotId',r.id,
        'preparationBatchId',r.preparation_batch_id,
        'inputCropCount',x.input_crop_count,
        'saleOrderIds',x.sale_order_ids,
        'principle','A sale of Ready inventory prepared from multiple crop cycles is real commercial truth, but it is not authority to assign the whole revenue back to any one crop.'
      ) as detail
    from atlas.flower_ready_inventory_lots r
    join lateral (
      select
        count(distinct o.crop_cycle_id) filter (where o.crop_cycle_id is not null) as input_crop_count,
        coalesce(jsonb_agg(distinct s.id) filter (where s.id is not null),'[]'::jsonb) as sale_order_ids
      from atlas.flower_preparation_inputs pi
      join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id
      left join atlas.flower_sale_order_lines sl on sl.ready_lot_id=r.id
      left join atlas.flower_sale_orders s on s.id=sl.sale_order_id
        and not exists (select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id)
      where pi.preparation_batch_id=r.preparation_batch_id
    ) x on true
    where (p_farm_id is null or r.farm_id=p_farm_id)
      and x.input_crop_count>1
      and jsonb_array_length(x.sale_order_ids)>0
  )
  select * from unprepared
  union all select * from commercial_gap
  union all select * from lineage_gap
  union all select * from fulfillment_gap
  union all select * from mixed_sale_context;
$function$;

revoke all on function atlas.harvest_realization_continuity_audit_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.harvest_realization_continuity_audit_v1(uuid) to service_role;
comment on function atlas.harvest_realization_continuity_audit_v1(uuid) is 'P10 read-only continuity audit for Harvest realization: physical output→preparation continuation, commercial-gap custody, Ready lineage, fulfillment continuation, and mixed-crop revenue attribution boundaries.';