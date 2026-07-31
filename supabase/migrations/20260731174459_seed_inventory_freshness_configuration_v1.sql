-- Owner-authored seed inventory freshness configuration and dashboard.

create or replace function atlas.seed_inventory_dashboard_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=pg_catalog,atlas,auth
as $$
declare
  v_role text;
  v_items jsonb;
begin
  if auth.uid() is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm membership is required to read seed inventory.' using errcode='42501';
  end if;
  v_role:=atlas.current_farm_role(p_farm_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'seedLotId',sip.seed_lot_id,
    'stableKey',sip.stable_key,
    'lotLabel',sip.lot_label,
    'cropLabel',sip.crop_label,
    'variety',sip.variety,
    'supplier',sip.supplier,
    'storageLocation',sip.storage_location,
    'seedLotStatus',sip.seed_lot_status,
    'recordedReceiptQuantity',sip.recorded_receipt_quantity,
    'quantityUnit',sip.quantity_unit,
    'observationStatus',coalesce(sip.observation_status,'verification_required'),
    'verifiedOnHandQuantity',sip.verified_on_hand_quantity,
    'projectedOnHandQuantity',sip.projected_on_hand_quantity,
    'outstandingReservedQuantity',sip.outstanding_reserved_quantity,
    'projectedUnreservedQuantity',sip.projected_unreserved_quantity,
    'lastVerifiedAt',sip.last_verified_at,
    'lastObservedAt',sip.last_observed_at,
    'countTrusted',coalesce(sip.count_trusted,false),
    'lowStockThreshold',sip.low_stock_threshold,
    'atOrBelowLowStockThreshold',coalesce(sip.at_or_below_low_stock_threshold,false),
    'stateNote',sip.state_note,
    'rhythm',case when sip.rhythm_state_id is null then null else jsonb_build_object(
      'stateId',sip.rhythm_state_id,'state',sip.rhythm_state,
      'warningAt',sip.warning_at,'dueAt',sip.due_at,'failureAt',sip.failure_at,
      'currentTaskId',coalesce(sip.rhythm_task_id,sip.state_task_id),
      'bindingActive',sip.binding_active
    ) end,
    'dependencies',coalesce((
      select jsonb_agg(jsonb_build_object(
        'allocationId',sac.allocation_id,
        'productionLotId',sac.production_lot_id,
        'productionLotLabel',sac.production_lot_label,
        'plannedSowDate',sac.planned_sow_date,
        'allocatedQuantity',sac.allocated_quantity,
        'outstandingQuantity',sac.outstanding_quantity,
        'coveredByTrustedInventory',sac.covered_by_trusted_inventory,
        'blockingReason',sac.blocking_reason
      ) order by sac.planned_sow_date nulls last,sac.allocation_id)
      from atlas.seed_allocation_coverage_v1 sac where sac.seed_lot_id=sip.seed_lot_id
    ),'[]'::jsonb),
    'eventCount',(select count(*) from atlas.seed_inventory_events sie where sie.seed_lot_id=sip.seed_lot_id)
  ) order by sip.crop_label,sip.variety,sip.lot_label),'[]'::jsonb)
  into v_items
  from atlas.seed_inventory_position_v1 sip
  where sip.farm_id=p_farm_id and sip.seed_lot_status<>'closed';

  return jsonb_build_object(
    'contractVersion','seed_inventory_dashboard_v1',
    'farmId',p_farm_id,
    'canManage',v_role='owner',
    'items',v_items
  );
end;
$$;

grant execute on function atlas.seed_inventory_dashboard_v1(uuid) to authenticated;

create or replace function atlas.configure_seed_inventory_freshness_core_v1(
  p_seed_lot_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_cadence_days integer,
  p_warning_days integer,
  p_grace_days integer,
  p_first_check_date date,
  p_low_stock_threshold numeric,
  p_reason text,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare
  v_lot atlas.seed_lots%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_assignee atlas.farm_memberships%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_binding atlas.rhythm_bindings%rowtype;
  v_state atlas.rhythm_state%rowtype;
  v_existing_state_id uuid;
  v_workflow_event_id uuid;
  v_satisfaction_id uuid;
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_target_at timestamptz;
  v_renewal integer;
  v_evaluation jsonb;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_role text:=lower(coalesce(p_effective_role,''));
begin
  if p_seed_lot_id is null or p_effective_membership_id is null then raise exception 'Seed lot and active membership are required.' using errcode='22023'; end if;
  if v_role<>'owner' then raise exception 'Only the farm Owner may configure seed inventory freshness.' using errcode='42501'; end if;
  if p_cadence_days is null or p_cadence_days<1 or p_cadence_days>365 then raise exception 'Freshness cadence must be 1 to 365 days.' using errcode='22023'; end if;
  if p_warning_days is null or p_warning_days<0 or p_warning_days>=p_cadence_days then raise exception 'Warning days must be zero or more and shorter than the cadence.' using errcode='22023'; end if;
  if p_grace_days is null or p_grace_days<0 or p_grace_days>90 then raise exception 'Grace days must be 0 to 90.' using errcode='22023'; end if;
  if p_first_check_date is null or p_first_check_date<v_today then raise exception 'Choose today or a future first count date.' using errcode='22023'; end if;
  if p_low_stock_threshold is not null and p_low_stock_threshold<0 then raise exception 'Low-stock threshold cannot be negative.' using errcode='22023'; end if;
  if v_reason is null or length(v_reason)>2000 then raise exception 'Record why this seed lot needs a freshness rule.' using errcode='22023'; end if;

  select * into v_lot from atlas.seed_lots where id=p_seed_lot_id for update;
  if v_lot.id is null then raise exception 'Seed lot was not found.' using errcode='P0002'; end if;
  if v_lot.status in ('closed','depleted') then raise exception 'Closed or depleted seed lots cannot start a freshness Clock.' using errcode='22023'; end if;

  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id and active;
  if v_membership.id is null or v_membership.farm_id<>v_lot.farm_id then raise exception 'Active membership for the seed lot farm is required.' using errcode='42501'; end if;
  if not p_operator_mode and (auth.uid() is null or v_membership.user_id<>auth.uid()) then raise exception 'This membership does not belong to the signed-in player.' using errcode='42501'; end if;

  select id into v_existing_state_id from atlas.rhythm_state
  where farm_id=v_lot.farm_id and rhythm_key='seed_inventory_freshness' and subject_kind='seed_lot' and subject_id=v_lot.id;
  if v_existing_state_id is not null then raise exception 'This seed lot already has a freshness rule. Revise it through the Rulebook.' using errcode='22023'; end if;

  select * into v_assignee from atlas.farm_memberships
  where farm_id=v_lot.farm_id and worker_key='anna' and role='farm_hand' and active
  order by created_at limit 1;
  if v_assignee.id is null then v_assignee:=v_membership; end if;

  insert into atlas.seed_inventory_state(
    seed_lot_id,organization_id,farm_id,status,unit,low_stock_threshold,metadata
  ) values(
    v_lot.id,(select organization_id from atlas.farms where id=v_lot.farm_id),v_lot.farm_id,
    'verification_required',v_lot.quantity_unit,p_low_stock_threshold,
    jsonb_build_object('governed',true,'configurationSource','owner_explicit_seed_inventory_v1')
  ) on conflict(seed_lot_id) do update set
    low_stock_threshold=excluded.low_stock_threshold,
    metadata=atlas.seed_inventory_state.metadata||excluded.metadata,
    updated_at=now();

  insert into atlas.rhythm_rules(
    organization_id,farm_id,rule_key,rhythm_key,version,label,status,applicability,
    validity_interval_seconds,warning_window_seconds,grace_window_seconds,
    qualifying_touches,failure_consequence,player_routing,created_by_user_id,activated_at,owner_reason,metadata
  ) values(
    (select organization_id from atlas.farms where id=v_lot.farm_id),v_lot.farm_id,
    'seed_inventory_freshness_'||v_lot.stable_key,'seed_inventory_freshness',1,
    'Seed count freshness · '||v_lot.lot_label,'active',
    jsonb_build_object('subjectKind','seed_lot','seedLotId',v_lot.id,'quantityUnit',v_lot.quantity_unit),
    p_cadence_days*86400,p_warning_days*86400,p_grace_days*86400,
    jsonb_build_array(
      jsonb_build_object('effect','full','sourceKind','seed_inventory','sourceEvent','count_confirmed'),
      jsonb_build_object('effect','full','sourceKind','seed_inventory','sourceEvent','count_corrected'),
      jsonb_build_object('effect','full','sourceKind','seed_inventory','sourceEvent','restocked'),
      jsonb_build_object('effect','full','sourceKind','seed_inventory','sourceEvent','depleted'),
      jsonb_build_object('effect','partial','sourceKind','seed_inventory','sourceEvent','unable_to_verify'),
      jsonb_build_object('effect','partial','sourceKind','seed_inventory','sourceEvent','problem_found'),
      jsonb_build_object('effect','full','sourceKind','seed_inventory','sourceEvent','retired')
    ),
    jsonb_build_object(
      'dueTask',jsonb_build_object(
        'title','Verify seed count — '||v_lot.lot_label,'priority','normal','taskType','seed_inventory_recount',
        'actionKey','recount_seed_inventory','workClass','light',
        'note','Count the physical seed on hand. Do not infer from receipt quantity or reservations.',
        'visibilityScope','assigned_worker','assignedMembershipId',v_assignee.id
      ),
      'failureTask',jsonb_build_object(
        'title','Restore seed count — '||v_lot.lot_label,'priority','high','taskType','seed_inventory_recount',
        'actionKey','recount_seed_inventory','workClass','light',
        'note','The last verified physical seed count expired. Recount before dependent sowing work relies on it.',
        'visibilityScope','assigned_worker','assignedMembershipId',v_assignee.id
      ),
      'timeClaimsInventoryQuantity',false
    ),
    jsonb_build_object(
      'visibilityScope','assigned_worker','assignedMembershipId',v_assignee.id,'assignedUserId',v_assignee.user_id,
      'dueRecipient','responsible_worker','failureEscalation','owner'
    ),
    v_membership.user_id,now(),v_reason,
    jsonb_build_object(
      'domain','seed_inventory','boundaryMode','exact_timestamp','timezoneName','America/Chicago',
      'configuredCadenceDays',p_cadence_days,'configuredWarningDays',p_warning_days,'configuredGraceDays',p_grace_days,
      'lowStockThreshold',p_low_stock_threshold,'timeClaimsInventoryQuantity',false,
      'configurationSource','owner_explicit_seed_inventory_v1'
    )
  ) returning * into v_rule;

  insert into atlas.rhythm_bindings(
    organization_id,farm_id,rhythm_rule_id,binding_key,inheritance_layer,subject_kind,subject_id,
    priority,active,active_from,created_by_user_id,owner_reason,metadata
  ) values(
    v_rule.organization_id,v_lot.farm_id,v_rule.id,'seed-inventory:'||v_lot.id::text,
    'subject_override','seed_lot',v_lot.id,100,true,now(),v_membership.user_id,v_reason,
    jsonb_build_object('seedLotId',v_lot.id,'configurationSource','owner_explicit_seed_inventory_v1')
  ) returning * into v_binding;

  insert into atlas.rhythm_state(
    organization_id,farm_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,subject_kind,subject_id,
    state,effective_rule_version,visibility_scope,assigned_user_id,state_reason,metadata
  ) values(
    v_rule.organization_id,v_lot.farm_id,v_binding.id,v_rule.id,'seed_inventory_freshness','seed_lot',v_lot.id,
    'uninitialized',v_rule.version,'assigned_worker',v_assignee.user_id,
    jsonb_build_object('source','owner_explicit_seed_inventory_v1','inventoryQuantityClaim','unknown_until_counted'),
    jsonb_build_object('seedLotId',v_lot.id,'firstCheckDate',p_first_check_date)
  ) returning * into v_state;

  v_target_at:=case when p_first_check_date=v_today then now() else (p_first_check_date::timestamp+time '08:00') at time zone 'America/Chicago' end;
  v_renewal:=greatest(1,ceil(extract(epoch from (v_target_at-now())))::integer);

  insert into atlas.workflow_events(farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload,created_at)
  values(
    v_lot.farm_id,'seed-inventory-config:'||v_state.id::text||':'||p_first_check_date::text,
    'seed_lot',v_lot.id,'seed_inventory:'||v_lot.id::text,'game_master_satisfaction',v_today,
    jsonb_build_object('rhythm_state_id',v_state.id,'reason',v_reason,'renewal_interval_seconds',v_renewal,
      'first_check_date',p_first_check_date,'clock_version','rhythm_clock_v1'),now()
  ) returning id into v_workflow_event_id;

  insert into atlas.rhythm_satisfactions(
    organization_id,farm_id,rhythm_state_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,subject_kind,subject_id,
    satisfaction_key,satisfaction_kind,satisfied_at,renewal_interval_seconds,source_kind,source_id,source_event,
    source_workflow_event_id,policy_match,evidence,created_by_user_id
  ) values(
    v_rule.organization_id,v_lot.farm_id,v_state.id,v_binding.id,v_rule.id,'seed_inventory_freshness','seed_lot',v_lot.id,
    'seed-inventory-config:'||v_state.id::text||':'||p_first_check_date::text,'game_master',now(),v_renewal,
    'owner_action',v_workflow_event_id,'game_master_satisfaction',v_workflow_event_id,
    jsonb_build_object('matchKind','owner_configured_first_count','reason',v_reason),
    jsonb_build_object('workflowEventId',v_workflow_event_id,'firstCheckDate',p_first_check_date,'cadenceDays',p_cadence_days),
    v_membership.user_id
  ) returning id into v_satisfaction_id;

  update atlas.rhythm_state set last_qualifying_satisfaction_id=v_satisfaction_id,lease_started_at=null,updated_at=now() where id=v_state.id;
  v_evaluation:=atlas.evaluate_rhythm_binding_v1(v_state.id,case when p_first_check_date=v_today then now()+interval '2 seconds' else now() end,'seed_inventory_configured');

  return jsonb_build_object(
    'contractVersion','seed_inventory_freshness_configure_v1','seedLotId',v_lot.id,
    'stateId',v_state.id,'ruleId',v_rule.id,'bindingId',v_binding.id,'evaluation',v_evaluation
  );
end;
$$;

create or replace function atlas.configure_seed_inventory_freshness_for_member_v1(
  p_seed_lot_id uuid,p_cadence_days integer,p_warning_days integer,p_grace_days integer,
  p_first_check_date date,p_low_stock_threshold numeric,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare v_lot atlas.seed_lots%rowtype;v_role text;v_membership uuid;
begin
  select * into v_lot from atlas.seed_lots where id=p_seed_lot_id;
  if v_lot.id is null then raise exception 'Seed lot was not found.' using errcode='P0002'; end if;
  v_role:=atlas.current_farm_role(v_lot.farm_id);v_membership:=atlas.current_membership_id(v_lot.farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.configure_seed_inventory_freshness_core_v1(
    p_seed_lot_id,v_membership,v_role,p_cadence_days,p_warning_days,p_grace_days,
    p_first_check_date,p_low_stock_threshold,p_reason,false
  );
end;
$$;

create or replace function atlas.owner_operator_configure_seed_inventory_freshness_v1(
  p_effective_membership_id uuid,p_seed_lot_id uuid,p_cadence_days integer,p_warning_days integer,
  p_grace_days integer,p_first_check_date date,p_low_stock_threshold numeric,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,atlas,auth
as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.configure_seed_inventory_freshness_core_v1(
    p_seed_lot_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',
    p_cadence_days,p_warning_days,p_grace_days,p_first_check_date,p_low_stock_threshold,p_reason,true
  );
end;
$$;

grant execute on function atlas.configure_seed_inventory_freshness_for_member_v1(uuid,integer,integer,integer,date,numeric,text) to authenticated;
grant execute on function atlas.owner_operator_configure_seed_inventory_freshness_v1(uuid,uuid,integer,integer,integer,date,numeric,text) to authenticated;