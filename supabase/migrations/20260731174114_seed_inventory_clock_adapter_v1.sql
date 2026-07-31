-- Seed inventory stock projection and Clock adapter.

create or replace view atlas.seed_inventory_position_v1
with (security_invoker=true)
as
with consumed_by_allocation as (
  select
    sla.id as allocation_id,
    sla.seed_lot_id,
    coalesce(sum(sac.quantity_consumed),0::numeric) as quantity_consumed
  from atlas.seed_lot_allocations sla
  left join atlas.seed_allocation_consumptions sac on sac.seed_lot_allocation_id=sla.id
  group by sla.id,sla.seed_lot_id
), lot_consumption as (
  select
    sla.seed_lot_id,
    coalesce(sum(sac.quantity_consumed),0::numeric) as total_consumed,
    coalesce(sum(sac.quantity_consumed) filter (
      where sis.last_verified_at is not null and sac.created_at>sis.last_verified_at
    ),0::numeric) as consumed_since_verification
  from atlas.seed_lot_allocations sla
  left join atlas.seed_allocation_consumptions sac on sac.seed_lot_allocation_id=sla.id
  left join atlas.seed_inventory_state sis on sis.seed_lot_id=sla.seed_lot_id
  group by sla.seed_lot_id
), outstanding as (
  select
    sla.seed_lot_id,
    coalesce(sum(greatest(sla.allocated_quantity-coalesce(cba.quantity_consumed,0),0)) filter (
      where sla.allocation_status not in ('released','cancelled')
    ),0::numeric) as outstanding_reserved_quantity
  from atlas.seed_lot_allocations sla
  left join consumed_by_allocation cba on cba.allocation_id=sla.id
  group by sla.seed_lot_id
)
select
  sl.id as seed_lot_id,
  sl.farm_id,
  sl.crop_profile_id,
  sl.stable_key,
  sl.lot_label,
  sl.crop_label,
  sl.variety,
  sl.supplier,
  sl.storage_location,
  sl.status as seed_lot_status,
  sl.received_quantity as recorded_receipt_quantity,
  sl.quantity_unit,
  sis.status as observation_status,
  sis.verified_on_hand_quantity,
  sis.last_verified_at,
  sis.last_observed_at,
  sis.source_event_id,
  sis.current_task_id as state_task_id,
  sis.next_check_date,
  sis.low_stock_threshold,
  sis.note as state_note,
  coalesce(lc.total_consumed,0::numeric) as total_consumed_quantity,
  coalesce(lc.consumed_since_verification,0::numeric) as consumed_since_verification,
  case
    when sis.verified_on_hand_quantity is null then null
    else greatest(sis.verified_on_hand_quantity-coalesce(lc.consumed_since_verification,0),0)
  end as projected_on_hand_quantity,
  coalesce(o.outstanding_reserved_quantity,0::numeric) as outstanding_reserved_quantity,
  case
    when sis.verified_on_hand_quantity is null then null
    else greatest(
      sis.verified_on_hand_quantity-coalesce(lc.consumed_since_verification,0)-coalesce(o.outstanding_reserved_quantity,0),
      0
    )
  end as projected_unreserved_quantity,
  rs.id as rhythm_state_id,
  rs.state as rhythm_state,
  rs.warning_at,
  rs.due_at,
  rs.failure_at,
  rs.current_task_id as rhythm_task_id,
  coalesce(rb.active,false) as binding_active,
  (
    sis.status in ('verified','depleted')
    and sis.verified_on_hand_quantity is not null
    and coalesce(rb.active,false)
    and rs.state in ('resting','coming_due')
  ) as count_trusted,
  (
    sis.low_stock_threshold is not null
    and sis.verified_on_hand_quantity is not null
    and greatest(sis.verified_on_hand_quantity-coalesce(lc.consumed_since_verification,0),0)<=sis.low_stock_threshold
  ) as at_or_below_low_stock_threshold,
  sis.metadata as state_metadata,
  sl.metadata as seed_lot_metadata
from atlas.seed_lots sl
left join atlas.seed_inventory_state sis on sis.seed_lot_id=sl.id
left join lot_consumption lc on lc.seed_lot_id=sl.id
left join outstanding o on o.seed_lot_id=sl.id
left join atlas.rhythm_state rs
  on rs.farm_id=sl.farm_id and rs.rhythm_key='seed_inventory_freshness'
  and rs.subject_kind='seed_lot' and rs.subject_id=sl.id
left join atlas.rhythm_bindings rb on rb.id=rs.rhythm_binding_id;

grant select on atlas.seed_inventory_position_v1 to authenticated;

create or replace view atlas.seed_allocation_coverage_v1
with (security_invoker=true)
as
with consumption as (
  select seed_lot_allocation_id,coalesce(sum(quantity_consumed),0::numeric) as quantity_consumed
  from atlas.seed_allocation_consumptions
  group by seed_lot_allocation_id
), base as (
  select
    sla.id as allocation_id,
    sla.seed_lot_id,
    sla.production_lot_id,
    sla.allocated_quantity,
    sla.unit,
    sla.allocation_status,
    sla.allocated_at,
    greatest(sla.allocated_quantity-coalesce(c.quantity_consumed,0),0) as outstanding_quantity,
    pl.lot_label as production_lot_label,
    pl.planned_sow_date,
    pl.lifecycle_status,
    sip.projected_on_hand_quantity,
    sip.count_trusted,
    sip.observation_status,
    sip.rhythm_state,
    sip.last_verified_at
  from atlas.seed_lot_allocations sla
  join atlas.production_lots pl on pl.id=sla.production_lot_id
  join atlas.seed_inventory_position_v1 sip on sip.seed_lot_id=sla.seed_lot_id
  left join consumption c on c.seed_lot_allocation_id=sla.id
  where sla.allocation_status not in ('released','cancelled')
), ranked as (
  select
    b.*,
    sum(b.outstanding_quantity) over (
      partition by b.seed_lot_id
      order by b.planned_sow_date nulls last,b.allocated_at,b.allocation_id
      rows between unbounded preceding and current row
    ) as cumulative_outstanding_quantity
  from base b
)
select
  r.*,
  (
    r.count_trusted
    and r.projected_on_hand_quantity is not null
    and r.cumulative_outstanding_quantity<=r.projected_on_hand_quantity
  ) as covered_by_trusted_inventory,
  case
    when not r.count_trusted then 'verified seed count is missing or stale'
    when r.projected_on_hand_quantity is null then 'verified on-hand quantity is unknown'
    when r.cumulative_outstanding_quantity>r.projected_on_hand_quantity then 'verified seed quantity does not cover this allocation'
    else null
  end as blocking_reason
from ranked r;

grant select on atlas.seed_allocation_coverage_v1 to authenticated;

create or replace view atlas.production_seed_readiness_v1
with (security_invoker=true)
as
select
  pl.id as production_lot_id,
  pl.farm_id,
  pl.lot_label,
  pl.planned_sow_date,
  coalesce(sum(sac.outstanding_quantity),0::numeric) as outstanding_allocated_quantity,
  coalesce(sum(sac.outstanding_quantity) filter (where sac.covered_by_trusted_inventory),0::numeric) as trusted_covered_quantity,
  bool_and(sac.covered_by_trusted_inventory) filter (where sac.outstanding_quantity>0) as all_seed_allocations_ready,
  string_agg(distinct sac.blocking_reason,'; ') filter (where sac.blocking_reason is not null) as blocking_reason
from atlas.production_lots pl
left join atlas.seed_allocation_coverage_v1 sac on sac.production_lot_id=pl.id
where pl.lifecycle_status in ('planned','active')
group by pl.id;

grant select on atlas.production_seed_readiness_v1 to authenticated;

create or replace function atlas.rhythm_subject_belongs_to_farm_v1(p_farm_id uuid,p_subject_kind text,p_subject_id uuid)
returns boolean
language sql
stable security definer
set search_path=pg_catalog,atlas
as $$
  select case p_subject_kind
    when 'farm' then p_subject_id=p_farm_id
    when 'zone' then exists(select 1 from atlas.zones z where z.id=p_subject_id and z.farm_id=p_farm_id)
    when 'growing_object' then exists(select 1 from atlas.growing_objects o where o.id=p_subject_id and o.farm_id=p_farm_id)
    when 'crop_cycle' then exists(select 1 from atlas.crop_cycles c where c.id=p_subject_id and c.farm_id=p_farm_id)
    when 'project' then exists(select 1 from atlas.projects p where p.id=p_subject_id and p.farm_id=p_farm_id)
    when 'seed_lot' then exists(select 1 from atlas.seed_lots sl where sl.id=p_subject_id and sl.farm_id=p_farm_id)
    when 'crop_profile' then exists(select 1 from atlas.crop_profiles cp where cp.id=p_subject_id)
    else false
  end;
$$;

create or replace function atlas.resolve_effective_rhythm_rule_for_clock_v2(p_state_id uuid,p_as_of timestamptz default now())
returns jsonb
language plpgsql
stable security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_state atlas.rhythm_state%rowtype;
  v_winner jsonb;
  v_as_of timestamptz:=coalesce(p_as_of,now());
begin
  select * into v_state from atlas.rhythm_state where id=p_state_id;
  if v_state.id is null then raise exception 'Rhythm state not found.' using errcode='P0002'; end if;
  if v_state.subject_kind<>'seed_lot' then
    return atlas.resolve_effective_rhythm_rule_for_clock_v1(p_state_id,v_as_of);
  end if;

  select jsonb_build_object(
    'bindingId',b.id,'bindingKey',b.binding_key,'inheritanceLayer',b.inheritance_layer,
    'bindingSubjectKind',b.subject_kind,'bindingSubjectId',b.subject_id,'bindingSubjectKey',b.subject_key,
    'priority',b.priority,
    'layerRank',case b.inheritance_layer when 'temporary_exception' then 600 when 'subject_override' then 500 when 'farm_default' then 100 else 0 end,
    'matchedOn',case when b.inheritance_layer='farm_default' then 'farm:'||v_state.farm_id::text else 'seed_lot:'||v_state.subject_id::text end,
    'ruleId',r.id,'ruleKey',r.rule_key,'rhythmKey',r.rhythm_key,'version',r.version,'label',r.label,
    'applicability',r.applicability,'validityIntervalSeconds',r.validity_interval_seconds,
    'warningWindowSeconds',r.warning_window_seconds,'graceWindowSeconds',r.grace_window_seconds,
    'qualifyingTouches',r.qualifying_touches,'failureConsequence',r.failure_consequence,
    'playerRouting',r.player_routing,'metadata',r.metadata
  ) into v_winner
  from atlas.rhythm_bindings b
  join atlas.rhythm_rules r on r.id=b.rhythm_rule_id
  where b.farm_id=v_state.farm_id and r.farm_id=v_state.farm_id
    and r.rhythm_key=v_state.rhythm_key and r.status='active' and b.active
    and (b.active_from is null or b.active_from<=v_as_of)
    and (b.active_until is null or b.active_until>v_as_of)
    and (
      (b.inheritance_layer='farm_default' and b.subject_kind='farm' and b.subject_id=v_state.farm_id)
      or (b.inheritance_layer in ('subject_override','temporary_exception') and b.subject_kind='seed_lot' and b.subject_id=v_state.subject_id)
    )
  order by
    case b.inheritance_layer when 'temporary_exception' then 600 when 'subject_override' then 500 when 'farm_default' then 100 else 0 end desc,
    b.priority desc,r.version desc,b.id
  limit 1;
  return v_winner;
end;
$$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='evaluate_rhythm_binding_v1'
    and p.oid::regprocedure::text='atlas.evaluate_rhythm_binding_v1(uuid,timestamp with time zone,text)';
  if v_definition not like '%resolve_effective_rhythm_rule_for_clock_v2%' then
    v_definition:=replace(
      v_definition,
      'atlas.resolve_effective_rhythm_rule_for_clock_v1(v_state.id, v_as_of)',
      'atlas.resolve_effective_rhythm_rule_for_clock_v2(v_state.id, v_as_of)'
    );
    execute v_definition;
  end if;
end;
$$;

create or replace function atlas.decorate_seed_inventory_clock_task_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_state atlas.rhythm_state%rowtype;
  v_lot atlas.seed_lots%rowtype;
begin
  if new.generated_from<>'rhythm_clock' or coalesce(new.metadata->>'rhythm_key','')<>'seed_inventory_freshness' then return new; end if;
  select * into v_state from atlas.rhythm_state where id=atlas.rhythm_safe_uuid_v1(new.metadata->>'rhythm_state_id');
  if v_state.id is null or v_state.subject_kind<>'seed_lot' then return new; end if;
  select * into v_lot from atlas.seed_lots where id=v_state.subject_id;
  if v_lot.id is null then return new; end if;

  new.title:=case when coalesce(new.metadata->>'rhythm_target_state','')='fallen_out_of_rhythm'
    then 'Restore seed count — '||v_lot.lot_label
    else 'Verify seed count — '||v_lot.lot_label end;
  new.task_type:='seed_inventory_recount';
  new.action_key:='recount_seed_inventory';
  new.work_class:='light';
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'task_style','seed_inventory_recount','structured_result_required',true,'clock_managed',true,
    'seed_lot_id',v_lot.id,'seed_lot_key',v_lot.stable_key,'seed_lot_label',v_lot.lot_label,
    'crop_label',v_lot.crop_label,'variety',v_lot.variety,'quantity_unit',v_lot.quantity_unit,
    'recorded_receipt_quantity',v_lot.received_quantity,'storage_location',v_lot.storage_location,
    'display_action','Verify seed count','display_subject',v_lot.lot_label,
    'display_detail','Count the physical seed on hand; do not infer from the receipt or reservations.',
    'collection_zone',coalesce(nullif(v_lot.storage_location,''),'Seed inventory'),
    'work_rhythm','Inventory Freshness','time_claims_inventory_quantity',false,
    'recreate_on_done',false
  );
  return new;
end;
$$;

drop trigger if exists tasks_decorate_seed_inventory_clock_v1 on atlas.tasks;
create trigger tasks_decorate_seed_inventory_clock_v1
before insert or update of generated_from,generated_from_id,metadata on atlas.tasks
for each row execute function atlas.decorate_seed_inventory_clock_task_v1();

create or replace function atlas.link_seed_inventory_clock_task_v1()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,atlas
as $$
declare v_state atlas.rhythm_state%rowtype;
begin
  if new.generated_from<>'rhythm_clock' or new.generated_from_id is null then return new; end if;
  select * into v_state from atlas.rhythm_state where id=new.generated_from_id;
  if v_state.subject_kind='seed_lot' and v_state.rhythm_key='seed_inventory_freshness' then
    insert into atlas.seed_lot_task_links(seed_lot_id,task_id,link_role,source,metadata)
    values(v_state.subject_id,new.id,'inventory_recount','rhythm_clock_v1',jsonb_build_object('rhythm_state_id',v_state.id))
    on conflict(seed_lot_id,task_id) do update set
      link_role=excluded.link_role,source=excluded.source,
      metadata=atlas.seed_lot_task_links.metadata||excluded.metadata,updated_at=now();
    update atlas.seed_inventory_state
    set current_task_id=new.id,updated_at=now()
    where seed_lot_id=v_state.subject_id;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_link_seed_inventory_clock_v1 on atlas.tasks;
create trigger tasks_link_seed_inventory_clock_v1
after insert or update of generated_from,generated_from_id,task_type,action_key,title on atlas.tasks
for each row execute function atlas.link_seed_inventory_clock_task_v1();