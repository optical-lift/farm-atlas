alter table atlas.seed_lots alter column received_quantity drop not null;
comment on column atlas.seed_lots.received_quantity is 'Recorded receipt quantity when known. NULL means the seed lot/body exists but its starting quantity is not established; unknown must never be represented as zero.';

alter table atlas.seed_inventory_state add column if not exists quantity_knowledge_kind text;
alter table atlas.seed_inventory_state add column if not exists known_lower_bound_quantity numeric;
update atlas.seed_inventory_state
set quantity_knowledge_kind=case when verified_on_hand_quantity is not null then 'exact' else 'unknown' end,
    known_lower_bound_quantity=case when verified_on_hand_quantity is not null then verified_on_hand_quantity else null end
where quantity_knowledge_kind is null;
alter table atlas.seed_inventory_state alter column quantity_knowledge_kind set default 'unknown';
alter table atlas.seed_inventory_state alter column quantity_knowledge_kind set not null;
alter table atlas.seed_inventory_state drop constraint if exists seed_inventory_state_quantity_knowledge_kind_check;
alter table atlas.seed_inventory_state add constraint seed_inventory_state_quantity_knowledge_kind_check
  check (quantity_knowledge_kind in ('unknown','positive_unknown','lower_bound','exact'));
alter table atlas.seed_inventory_state drop constraint if exists seed_inventory_state_known_lower_bound_quantity_check;
alter table atlas.seed_inventory_state add constraint seed_inventory_state_known_lower_bound_quantity_check
  check (known_lower_bound_quantity is null or known_lower_bound_quantity>=0);
alter table atlas.seed_inventory_state drop constraint if exists seed_inventory_state_quantity_knowledge_consistency_check;
alter table atlas.seed_inventory_state add constraint seed_inventory_state_quantity_knowledge_consistency_check
  check (
    (quantity_knowledge_kind='exact' and verified_on_hand_quantity is not null and known_lower_bound_quantity=verified_on_hand_quantity)
    or (quantity_knowledge_kind='lower_bound' and verified_on_hand_quantity is null and known_lower_bound_quantity is not null)
    or (quantity_knowledge_kind in ('unknown','positive_unknown') and verified_on_hand_quantity is null)
  );

alter table atlas.seed_inventory_state drop constraint if exists seed_inventory_state_status_check;
alter table atlas.seed_inventory_state add constraint seed_inventory_state_status_check
  check (status in ('verification_required','verified','bounded','uncertain','problem','depleted','retired'));

alter table atlas.seed_inventory_events drop constraint if exists seed_inventory_events_outcome_check;
alter table atlas.seed_inventory_events add constraint seed_inventory_events_outcome_check
  check (outcome in (
    'count_confirmed','count_corrected','restocked','depleted','unable_to_verify','problem_found','retired',
    'lower_bound_confirmed','direct_sow_exact_remaining','direct_sow_remaining_unknown'
  ));
alter table atlas.seed_inventory_events drop constraint if exists seed_inventory_events_check;
alter table atlas.seed_inventory_events add constraint seed_inventory_events_check
  check (
    (outcome in ('count_confirmed','count_corrected','restocked','lower_bound_confirmed','direct_sow_exact_remaining') and observed_quantity is not null)
    or (outcome='depleted' and observed_quantity=0)
    or (outcome in ('unable_to_verify','problem_found','retired'))
    or (outcome='direct_sow_remaining_unknown' and observed_quantity is null)
  );

alter table atlas.seed_lot_task_links drop constraint if exists seed_lot_task_links_link_role_check;
alter table atlas.seed_lot_task_links add constraint seed_lot_task_links_link_role_check
  check (link_role in ('inventory_recount','inventory_problem','inventory_purchase_decision','sowing_input'));

insert into atlas.seed_lots(
  farm_id,crop_profile_id,stable_key,lot_label,crop_label,variety,source_type,supplier,
  received_quantity,quantity_unit,status,metadata
)
select
  f.id,cp.id,'procut_orange_second_bag_existing_inventory_2026',
  'ProCut Orange · second bag','Sunflower','ProCut Orange','existing_inventory',null,
  null,'seeds','available',jsonb_build_object(
    'source','owner_and_worker_operational_record_20260814_20260817',
    'quantity_claim','unknown_starting_quantity',
    'bag_identity','second ProCut Orange bag',
    'horizon_status_at_source','exhausted',
    'truth_boundary','Body identity is established; starting seed count is not.'
  )
from atlas.farms f
cross join atlas.crop_profiles cp
where f.id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and cp.stable_key='sunflower_procut_orange'
on conflict(farm_id,stable_key) do update set
  crop_profile_id=excluded.crop_profile_id,
  lot_label=excluded.lot_label,
  status=case when atlas.seed_lots.status='depleted' then atlas.seed_lots.status else 'available' end,
  metadata=coalesce(atlas.seed_lots.metadata,'{}'::jsonb)||excluded.metadata,
  updated_at=now();

with lot as (
  select sl.id seed_lot_id,sl.farm_id,sl.quantity_unit,f.organization_id
  from atlas.seed_lots sl join atlas.farms f on f.id=sl.farm_id
  where sl.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
    and sl.stable_key='procut_orange_second_bag_existing_inventory_2026'
), decision as (
  select t.id task_id,coalesce(tt.created_at,t.updated_at) observed_at
  from atlas.tasks t
  left join lateral (
    select created_at from atlas.task_transitions x where x.task_id=t.id and x.next_status='done' order by x.created_at desc limit 1
  ) tt on true
  where t.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
    and t.metadata->>'task_key'='owner_20260815_check_orange_inventory_decide_fr11_fr12'
  limit 1
), ins as (
  insert into atlas.seed_inventory_events(
    organization_id,farm_id,seed_lot_id,task_id,rhythm_state_id,event_key,outcome,observed_at,
    observed_quantity,quantity_added,unit,source,problem_kind,next_check_date,note,
    created_by_user_id,effective_membership_id,metadata
  )
  select lot.organization_id,lot.farm_id,lot.seed_lot_id,decision.task_id,null,
    'or3:procut-orange:fr11-fr12-minimum-bound','lower_bound_confirmed',decision.observed_at,
    540,null,lot.quantity_unit,'owner_operational_decision',null,null,
    'Owner decision after the FR13/FR14 sowing committed the remaining Orange to FR11 + FR12. The task geometry requires 540 seeds, so this proves at least 540 remained; it does not prove an exact balance.',
    null,null,jsonb_build_object(
      'quantityRelation','at_least','lowerBoundQuantity',540,'unit',lot.quantity_unit,
      'basis','completed owner decision to sow both 30-ft beds at 3 rows and 4-inch spacing',
      'sourceWorkerTaskKey','owner_20260814_sow_procut_orange_fr13_fr14',
      'futureTaskKey','anna_20260817_sow_procut_orange_fr11_fr12_after_turnover',
      'truthBoundary','This is a minimum bound, not an inferred exact physical count.'
    )
  from lot,decision
  on conflict(farm_id,event_key) do update set note=excluded.note,metadata=excluded.metadata
  returning id,seed_lot_id,farm_id,organization_id,observed_at
)
insert into atlas.seed_inventory_state(
  seed_lot_id,organization_id,farm_id,status,verified_on_hand_quantity,unit,last_verified_at,last_observed_at,
  source_event_id,current_task_id,next_check_date,low_stock_threshold,note,metadata,quantity_knowledge_kind,known_lower_bound_quantity
)
select ins.seed_lot_id,ins.organization_id,ins.farm_id,'bounded',null,'seeds',null,ins.observed_at,
  ins.id,null,null,null,
  'At least 540 ProCut Orange seeds were established by the completed FR11/FR12 go-forward decision; exact balance remains unknown.',
  jsonb_build_object('source','or3_direct_sow_seed_state','quantityRelation','at_least','timeClaimsExactQuantity',false),
  'lower_bound',540
from ins
on conflict(seed_lot_id) do update set
  status=case when atlas.seed_inventory_state.status='depleted' then atlas.seed_inventory_state.status else 'bounded' end,
  verified_on_hand_quantity=case when atlas.seed_inventory_state.status='depleted' then atlas.seed_inventory_state.verified_on_hand_quantity else null end,
  last_observed_at=greatest(atlas.seed_inventory_state.last_observed_at,excluded.last_observed_at),
  source_event_id=case when atlas.seed_inventory_state.status='depleted' then atlas.seed_inventory_state.source_event_id else excluded.source_event_id end,
  note=case when atlas.seed_inventory_state.status='depleted' then atlas.seed_inventory_state.note else excluded.note end,
  metadata=atlas.seed_inventory_state.metadata||excluded.metadata,
  quantity_knowledge_kind=case when atlas.seed_inventory_state.status='depleted' then atlas.seed_inventory_state.quantity_knowledge_kind else 'lower_bound' end,
  known_lower_bound_quantity=case when atlas.seed_inventory_state.status='depleted' then atlas.seed_inventory_state.known_lower_bound_quantity else 540 end,
  updated_at=now();

insert into atlas.seed_lot_task_links(seed_lot_id,task_id,link_role,source,metadata)
select sl.id,t.id,'sowing_input','or3_direct_sow_seed_backfill',jsonb_build_object(
  'seedLotKey',sl.stable_key,'relation','USES/CONSUMES','truthBoundary','Task identity and seed body remain distinct.'
)
from atlas.seed_lots sl
join atlas.tasks t on t.farm_id=sl.farm_id
where sl.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and sl.stable_key='procut_orange_second_bag_existing_inventory_2026'
  and t.metadata->>'task_key' in ('owner_20260814_sow_procut_orange_fr13_fr14','anna_20260817_sow_procut_orange_fr11_fr12_after_turnover')
on conflict(seed_lot_id,task_id) do update set
  link_role='sowing_input',source=excluded.source,metadata=atlas.seed_lot_task_links.metadata||excluded.metadata,updated_at=now();

update atlas.tasks t
set metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
  'seed_governance_required',true,
  'seed_inventory_report_required',true,
  'seed_requirement_quantity',540,
  'seed_requirement_unit','seeds',
  'seed_requirement_source','canonical_geometry:2x30ft_beds:3_rows:4in',
  'seed_lot_id',(select sl.id from atlas.seed_lots sl where sl.farm_id=t.farm_id and sl.stable_key='procut_orange_second_bag_existing_inventory_2026'),
  'operation_result_membrane','or3_direct_sow_seed_v1'
),updated_at=now()
where t.farm_id='6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and t.metadata->>'task_key'='anna_20260817_sow_procut_orange_fr11_fr12_after_turnover';

create or replace function atlas.task_direct_sow_seed_requirement_v1(p_task_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_explicit numeric;
  v_rows numeric;
  v_spacing numeric;
  v_quantity numeric;
  v_object_count integer:=0;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  begin v_explicit:=nullif(v_task.metadata->>'seed_requirement_quantity','')::numeric; exception when others then v_explicit:=null; end;
  if v_explicit is not null and v_explicit>0 then
    return jsonb_build_object('known',true,'quantity',v_explicit,'unit',coalesce(nullif(v_task.metadata->>'seed_requirement_unit',''),'seeds'),'source',coalesce(nullif(v_task.metadata->>'seed_requirement_source',''),'explicit_task_requirement'));
  end if;
  begin v_rows:=nullif(v_task.metadata->>'rows_per_3ft_bed','')::numeric; exception when others then v_rows:=null; end;
  begin v_spacing:=nullif(v_task.metadata->>'in_row_spacing_in','')::numeric; exception when others then v_spacing:=null; end;
  if v_rows is null or v_rows<=0 or v_spacing is null or v_spacing<=0 then
    return jsonb_build_object('known',false,'state','seed_requirement_unknown','reason','Rows-per-bed or in-row spacing is not established.');
  end if;
  with raw_ids as (
    select value raw from jsonb_array_elements_text(case when jsonb_typeof(v_task.metadata->'target_object_ids')='array' then v_task.metadata->'target_object_ids' else '[]'::jsonb end)
    union all select v_task.metadata->>'target_object_id' where nullif(v_task.metadata->>'target_object_id','') is not null
  ), ids as (
    select distinct raw::uuid id from raw_ids where raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select count(*)::integer,coalesce(sum(ceil((go.length_ft*12)/v_spacing)*v_rows),0)
  into v_object_count,v_quantity
  from ids join atlas.growing_objects go on go.id=ids.id and go.farm_id=v_task.farm_id
  where go.length_ft is not null and go.length_ft>0;
  if v_object_count=0 or v_quantity<=0 then
    return jsonb_build_object('known',false,'state','seed_requirement_unknown','reason','Canonical target-bed geometry is missing.','rowsPerBed',v_rows,'spacingInches',v_spacing);
  end if;
  return jsonb_build_object('known',true,'quantity',v_quantity,'unit','seeds','source','canonical_target_geometry','targetObjectCount',v_object_count,'rowsPerBed',v_rows,'spacingInches',v_spacing);
end;
$$;

create or replace function atlas.task_seed_readiness_v1(p_task_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_requirement jsonb;
  v_required numeric;
  v_link_count integer:=0;
  v_seed_lot_id uuid;
  v_lot atlas.seed_lots%rowtype;
  v_state atlas.seed_inventory_state%rowtype;
  v_available numeric;
  v_ready boolean:=false;
  v_state_label text;
  v_reason text;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  if coalesce(v_task.metadata->>'seed_governance_required','false')<>'true' then
    return jsonb_build_object('contractVersion','task_seed_readiness_v1','taskId',p_task_id,'applicable',false,'ready',true,'state','not_applicable');
  end if;
  v_requirement:=atlas.task_direct_sow_seed_requirement_v1(p_task_id);
  if not coalesce((v_requirement->>'known')::boolean,false) then
    return jsonb_build_object('contractVersion','task_seed_readiness_v1','taskId',p_task_id,'applicable',true,'ready',false,'state','seed_requirement_unknown','requirement',v_requirement);
  end if;
  v_required:=(v_requirement->>'quantity')::numeric;
  select count(*)::integer,(array_agg(link.seed_lot_id order by link.seed_lot_id))[1]
  into v_link_count,v_seed_lot_id
  from atlas.seed_lot_task_links link where link.task_id=p_task_id and link.link_role='sowing_input';
  if v_link_count<>1 then
    return jsonb_build_object('contractVersion','task_seed_readiness_v1','taskId',p_task_id,'applicable',true,'ready',false,'state',case when v_link_count=0 then 'seed_source_unbound' else 'seed_source_ambiguous' end,'requirement',v_requirement,'seedSourceCount',v_link_count);
  end if;
  select * into v_lot from atlas.seed_lots where id=v_seed_lot_id;
  select * into v_state from atlas.seed_inventory_state where seed_lot_id=v_seed_lot_id;
  if v_lot.id is null or v_state.seed_lot_id is null then
    return jsonb_build_object('contractVersion','task_seed_readiness_v1','taskId',p_task_id,'applicable',true,'ready',false,'state','seed_state_missing','seedLotId',v_seed_lot_id,'requirement',v_requirement);
  end if;
  if v_state.quantity_knowledge_kind='exact' then
    v_available:=v_state.verified_on_hand_quantity;
    v_ready:=coalesce(v_available,0)>=v_required and v_state.status not in ('depleted','problem','retired','uncertain');
    v_state_label:=case when v_ready then 'ready_exact' when v_state.status='depleted' or coalesce(v_available,0)=0 then 'depleted' else 'insufficient_exact' end;
  elsif v_state.quantity_knowledge_kind='lower_bound' then
    v_available:=v_state.known_lower_bound_quantity;
    v_ready:=coalesce(v_available,0)>=v_required and v_state.status='bounded';
    v_state_label:=case when v_ready then 'ready_lower_bound' else 'lower_bound_insufficient' end;
  elsif v_state.quantity_knowledge_kind='positive_unknown' then
    v_state_label:='positive_quantity_unmeasured';
    v_reason:='Seed is known to remain, but no quantified warrant covers this sowing requirement.';
  else
    v_state_label:='quantity_unknown';
    v_reason:='Seed quantity is not established.';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','task_seed_readiness_v1','taskId',p_task_id,'applicable',true,'ready',v_ready,'state',v_state_label,
    'seedLotId',v_seed_lot_id,'seedLotKey',v_lot.stable_key,'seedLotLabel',v_lot.lot_label,
    'quantityKnowledgeKind',v_state.quantity_knowledge_kind,'availableWarrantQuantity',v_available,
    'requirement',v_requirement,'reason',v_reason,'sourceEventId',v_state.source_event_id,
    'truthBoundary',jsonb_build_object('lowerBoundIsNotExact',true,'positiveUnknownDoesNotSatisfyQuantifiedRequirement',true,'unknownIsNotZero',true,'taskCompletionIsNotInventoryTruth',true)
  ));
end;
$$;

create or replace function atlas.task_execution_readiness_v1(p_task_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_prereq boolean;
  v_resources boolean;
  v_destination jsonb;
  v_seed jsonb;
  v_seed_ready boolean;
begin
  v_prereq:=atlas.task_prerequisites_ready_v1(p_task_id);
  v_resources:=atlas.task_required_resources_available_v1(p_task_id);
  v_destination:=atlas.task_execution_destination_readiness_v1(p_task_id);
  v_seed:=atlas.task_seed_readiness_v1(p_task_id);
  v_seed_ready:=coalesce((v_seed->>'ready')::boolean,false);
  return jsonb_build_object(
    'contractVersion','task_execution_readiness_v1','taskId',p_task_id,
    'ready',v_prereq and v_resources and coalesce((v_destination->>'ready')::boolean,false) and v_seed_ready,
    'prerequisitesReady',v_prereq,'resourcesReady',v_resources,
    'destinationReady',coalesce((v_destination->>'ready')::boolean,false),'seedReady',v_seed_ready,
    'destination',v_destination,'seed',v_seed
  );
end;
$$;

update atlas.task_completion_impact_policies p
set acceptable_state_impacts=(select array_agg(distinct x order by x) from unnest(coalesce(p.acceptable_state_impacts,'{}'::text[])||array['seed_inventory_event','seed_inventory_state']) x),
  description=p.description||' OR3: when a sow task declares seed inventory reporting, completion must also preserve the post-operation seed state.',
  updated_at=now()
where p.action_family in ('sow','seed_sowing');

revoke all on function atlas.task_direct_sow_seed_requirement_v1(uuid) from public,anon,authenticated;
revoke all on function atlas.task_seed_readiness_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.task_direct_sow_seed_requirement_v1(uuid) to service_role;
grant execute on function atlas.task_seed_readiness_v1(uuid) to service_role;

comment on function atlas.task_seed_readiness_v1(uuid) is 'OR3 seed-domain execution gate. Exact quantity and evidence-backed lower bounds may authorize quantified direct sowing; positive-unknown and unknown quantities may not. Seed remains a differentiated domain rather than a generic resource.';