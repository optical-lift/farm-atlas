create or replace function atlas.record_direct_sow_seed_effect_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_remaining_state text,
  p_remaining_quantity numeric,
  p_note text,
  p_idempotency_key text
) returns jsonb
language plpgsql volatile security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_seed_lot_id uuid;
  v_lot atlas.seed_lots%rowtype;
  v_requirement jsonb;
  v_required numeric;
  v_event atlas.seed_inventory_events%rowtype;
  v_existing atlas.seed_inventory_events%rowtype;
  v_outcome text;
  v_status text;
  v_knowledge text;
  v_exact numeric;
  v_lower numeric;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_transition jsonb;
  v_org uuid;
  v_result_state text:=lower(btrim(coalesce(p_remaining_state,'')));
begin
  if p_task_id is null or p_effective_membership_id is null or v_key is null or length(v_key)>160 then
    raise exception 'Task, active membership, and idempotency key are required.' using errcode='22023';
  end if;
  if v_result_state not in ('depleted','exact_remaining','some_left_unknown') then
    raise exception 'Choose depleted, exact_remaining, or some_left_unknown.' using errcode='22023';
  end if;
  if v_result_state='exact_remaining' and (p_remaining_quantity is null or p_remaining_quantity<=0) then
    raise exception 'exact_remaining requires a positive remaining seed count; use depleted for zero.' using errcode='22023';
  end if;
  if v_result_state<>'exact_remaining' and p_remaining_quantity is not null then
    raise exception 'Remaining quantity is only accepted with exact_remaining.' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Direct-sow task was not found.' using errcode='P0002'; end if;
  if v_task.status not in ('open','blocked') then raise exception 'Direct-sow task is not open.' using errcode='22023'; end if;
  if coalesce(v_task.metadata->>'seed_governance_required','false')<>'true' or coalesce(v_task.metadata->>'seed_inventory_report_required','false')<>'true' then
    raise exception 'This sowing task does not declare the OR3 seed-result contract.' using errcode='22023';
  end if;

  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id and farm_id=v_task.farm_id and active;
  if v_membership.id is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  select link.seed_lot_id into v_seed_lot_id
  from atlas.seed_lot_task_links link
  where link.task_id=v_task.id and link.link_role='sowing_input'
  order by link.created_at,link.seed_lot_id limit 1;
  if v_seed_lot_id is null then raise exception 'Sowing task is missing its canonical seed-lot input.' using errcode='22023'; end if;
  select * into v_lot from atlas.seed_lots where id=v_seed_lot_id and farm_id=v_task.farm_id for update;
  if v_lot.id is null then raise exception 'Canonical sowing seed lot was not found.' using errcode='P0002'; end if;

  v_requirement:=atlas.task_direct_sow_seed_requirement_v1(v_task.id);
  if not coalesce((v_requirement->>'known')::boolean,false) then raise exception 'Sowing seed requirement is not established.' using errcode='22023'; end if;
  v_required:=(v_requirement->>'quantity')::numeric;
  select organization_id into v_org from atlas.farms where id=v_task.farm_id;

  perform pg_advisory_xact_lock(hashtextextended(v_task.farm_id::text||':direct-sow-seed:'||v_key,0));
  select * into v_existing from atlas.seed_inventory_events where farm_id=v_task.farm_id and event_key=v_key;
  if v_existing.id is not null then
    return jsonb_build_object('eventId',v_existing.id,'taskId',v_task.id,'seedLotId',v_seed_lot_id,'outcome',v_existing.outcome,'deduplicated',true,'seedReadiness',atlas.task_seed_readiness_v1(v_task.id));
  end if;

  if v_result_state='depleted' then
    v_outcome:='depleted'; v_status:='depleted'; v_knowledge:='exact'; v_exact:=0; v_lower:=0;
  elsif v_result_state='exact_remaining' then
    v_outcome:='direct_sow_exact_remaining'; v_status:='verified'; v_knowledge:='exact'; v_exact:=p_remaining_quantity; v_lower:=p_remaining_quantity;
  else
    v_outcome:='direct_sow_remaining_unknown'; v_status:='uncertain'; v_knowledge:='positive_unknown'; v_exact:=null; v_lower:=null;
  end if;

  insert into atlas.seed_inventory_events(
    organization_id,farm_id,seed_lot_id,task_id,rhythm_state_id,event_key,outcome,observed_at,
    observed_quantity,quantity_added,unit,source,problem_kind,next_check_date,note,
    created_by_user_id,effective_membership_id,metadata
  ) values(
    v_org,v_task.farm_id,v_seed_lot_id,v_task.id,null,v_key,v_outcome,now(),
    case when v_result_state='depleted' then 0 when v_result_state='exact_remaining' then p_remaining_quantity else null end,
    null,v_lot.quantity_unit,'direct_sow_result',null,null,nullif(btrim(coalesce(p_note,'')),''),
    auth.uid(),v_membership.id,jsonb_build_object(
      'operationEffect','direct_sow_seed_result','remainingState',v_result_state,
      'operationRequiredQuantity',v_required,'operationRequiredUnit',v_requirement->>'unit',
      'requirementSource',v_requirement->>'source','timeClaimsExactPhysicalConsumption',false,
      'truthBoundary','Operation geometry establishes required placement quantity; the post-sow witness establishes remaining inventory. Exact physical consumption is not fabricated from an unknown starting balance.'
    )
  ) returning * into v_event;

  insert into atlas.seed_inventory_state(
    seed_lot_id,organization_id,farm_id,status,verified_on_hand_quantity,unit,last_verified_at,last_observed_at,
    source_event_id,current_task_id,next_check_date,low_stock_threshold,note,metadata,quantity_knowledge_kind,known_lower_bound_quantity
  ) values(
    v_seed_lot_id,v_org,v_task.farm_id,v_status,v_exact,v_lot.quantity_unit,
    case when v_knowledge='exact' then v_event.observed_at else null end,v_event.observed_at,v_event.id,null,null,
    (select low_stock_threshold from atlas.seed_inventory_state where seed_lot_id=v_seed_lot_id),
    nullif(btrim(coalesce(p_note,'')),''),jsonb_build_object(
      'source','direct_sow_seed_result_v1','lastDirectSowTaskId',v_task.id,'remainingState',v_result_state,
      'operationRequiredQuantity',v_required,'timeClaimsExactPhysicalConsumption',false
    ),v_knowledge,v_lower
  ) on conflict(seed_lot_id) do update set
    status=excluded.status,verified_on_hand_quantity=excluded.verified_on_hand_quantity,unit=excluded.unit,
    last_verified_at=excluded.last_verified_at,last_observed_at=excluded.last_observed_at,
    source_event_id=excluded.source_event_id,current_task_id=null,next_check_date=null,note=excluded.note,
    metadata=atlas.seed_inventory_state.metadata||excluded.metadata,
    quantity_knowledge_kind=excluded.quantity_knowledge_kind,known_lower_bound_quantity=excluded.known_lower_bound_quantity,updated_at=now();

  update atlas.seed_lots set
    status=case when v_result_state='depleted' then 'depleted' else 'available' end,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'last_seed_inventory_event_id',v_event.id,'last_direct_sow_task_id',v_task.id,
      'current_inventory_status',v_status,'quantity_knowledge_kind',v_knowledge
    ),updated_at=now()
  where id=v_seed_lot_id;

  v_transition:=atlas.record_task_transition_v1_internal(
    v_task.id,'done',left(v_key||':task:done',160),null,
    coalesce(nullif(btrim(coalesce(p_note,'')),''),'Direct sowing completed and seed remainder recorded.'),null,
    'sow','direct_sow_seed',jsonb_build_object(
      'seed_inventory_event_id',v_event.id,'seed_lot_id',v_seed_lot_id,'remaining_state',v_result_state,
      'remaining_quantity',p_remaining_quantity,'required_seed_quantity',v_required,'required_seed_unit',v_requirement->>'unit'
    ),null
  );

  return jsonb_build_object(
    'contractVersion','direct_sow_seed_effect_v1','eventId',v_event.id,'taskId',v_task.id,'seedLotId',v_seed_lot_id,
    'remainingState',v_result_state,'remainingQuantity',p_remaining_quantity,'requiredSeedQuantity',v_required,
    'transition',v_transition,'inventoryState',(select to_jsonb(s) from atlas.seed_inventory_state s where s.seed_lot_id=v_seed_lot_id),
    'deduplicated',false
  );
end;
$$;
revoke all on function atlas.record_direct_sow_seed_effect_v1(uuid,uuid,text,numeric,text,text) from public,anon,authenticated;
grant execute on function atlas.record_direct_sow_seed_effect_v1(uuid,uuid,text,numeric,text,text) to service_role;