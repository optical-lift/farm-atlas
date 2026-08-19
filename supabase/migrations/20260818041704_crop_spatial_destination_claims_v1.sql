create table if not exists atlas.crop_destination_claims (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete cascade,
  destination_object_id uuid not null references atlas.growing_objects(id) on delete restrict,
  source_task_id uuid references atlas.tasks(id) on delete set null,
  recorded_by_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  claim_source text not null,
  claimed_quantity numeric,
  unit text,
  required_by date,
  window_start date,
  window_end date,
  claim_strength text not null default 'planned' check (claim_strength in ('tentative','planned','committed','protected','fixed')),
  displacement_authority text not null default 'farm_operations' check (displacement_authority in ('worker_discretion','farm_operations','management','principal','explicit_cancellation_only')),
  protection_reason text,
  status text not null default 'active' check (status in ('active','released','fulfilled','cancelled')),
  source_evidence jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crop_destination_claims_quantity_pair_check check ((claimed_quantity is null and unit is null) or (claimed_quantity is not null and claimed_quantity > 0 and nullif(btrim(unit),'') is not null)),
  constraint crop_destination_claims_window_check check (window_start is null or window_end is null or window_end >= window_start),
  constraint crop_destination_claims_farm_key_unique unique (farm_id,idempotency_key)
);

create unique index if not exists crop_destination_claims_active_cycle_object_uq
  on atlas.crop_destination_claims(crop_cycle_id,destination_object_id)
  where status='active';

create index if not exists crop_destination_claims_cycle_status_idx
  on atlas.crop_destination_claims(crop_cycle_id,status);
create index if not exists crop_destination_claims_object_status_idx
  on atlas.crop_destination_claims(destination_object_id,status);

alter table atlas.crop_destination_claims enable row level security;
revoke all on atlas.crop_destination_claims from public,anon,authenticated;
grant select,insert,update,delete on atlas.crop_destination_claims to service_role;

create or replace function atlas.validate_crop_destination_claim_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_task atlas.tasks%rowtype;
  v_member atlas.farm_memberships%rowtype;
begin
  select * into v_cycle from atlas.crop_cycles where id=new.crop_cycle_id;
  if v_cycle.id is null or v_cycle.farm_id is distinct from new.farm_id then
    raise exception 'Crop destination claim cycle is outside this farm.' using errcode='22023';
  end if;
  if new.status='active' and coalesce(v_cycle.lifecycle_status,'active') not in ('planned','active') then
    raise exception 'An active destination claim cannot attach to a terminal crop cycle.' using errcode='22023';
  end if;

  select * into v_object from atlas.growing_objects where id=new.destination_object_id;
  if v_object.id is null or v_object.farm_id is distinct from new.farm_id then
    raise exception 'Crop destination claim object is outside this farm.' using errcode='22023';
  end if;

  if new.source_task_id is not null then
    select * into v_task from atlas.tasks where id=new.source_task_id;
    if v_task.id is null or v_task.farm_id is distinct from new.farm_id then
      raise exception 'Crop destination claim source task is outside this farm.' using errcode='22023';
    end if;
  end if;

  if new.recorded_by_membership_id is not null then
    select * into v_member from atlas.farm_memberships where id=new.recorded_by_membership_id;
    if v_member.id is null or not v_member.active or v_member.farm_id is distinct from new.farm_id then
      raise exception 'Crop destination claim recorder must be an active farm member.' using errcode='22023';
    end if;
  end if;

  new.updated_at:=now();
  if new.status<>'active' and new.released_at is null then new.released_at:=now(); end if;
  return new;
end;
$function$;

revoke all on function atlas.validate_crop_destination_claim_v1() from public,anon,authenticated;

drop trigger if exists crop_destination_claims_validate_v1 on atlas.crop_destination_claims;
create trigger crop_destination_claims_validate_v1
before insert or update on atlas.crop_destination_claims
for each row execute function atlas.validate_crop_destination_claim_v1();

create or replace function atlas.crop_spatial_destination_reality_expression_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_zone_key text;
  v_claims jsonb:='[]'::jsonb;
  v_claim_count integer:=0;
  v_placements jsonb:='[]'::jsonb;
  v_placement_count integer:=0;
  v_resolution jsonb:=null;
  v_legacy jsonb:='[]'::jsonb;
  v_state text;
  v_destination_warrant boolean:=false;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle was not found.' using errcode='P0002'; end if;
  select * into v_object from atlas.growing_objects where id=v_cycle.object_id;
  select z.stable_key into v_zone_key from atlas.zones z where z.id=v_object.zone_id;

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'claimId',c.id,
           'destinationObjectId',c.destination_object_id,
           'destinationObjectKey',go.stable_key,
           'destinationLabel',go.label,
           'destinationZoneKey',z.stable_key,
           'claimedQuantity',c.claimed_quantity,
           'unit',c.unit,
           'requiredBy',c.required_by,
           'windowStart',c.window_start,
           'windowEnd',c.window_end,
           'claimStrength',c.claim_strength,
           'displacementAuthority',c.displacement_authority,
           'protectionReason',c.protection_reason,
           'claimSource',c.claim_source,
           'sourceTaskId',c.source_task_id,
           'sourceEvidence',c.source_evidence
         )) order by c.required_by nulls last,go.label,c.id),'[]'::jsonb)
  into v_claim_count,v_claims
  from atlas.crop_destination_claims c
  join atlas.growing_objects go on go.id=c.destination_object_id
  left join atlas.zones z on z.id=go.zone_id
  where c.crop_cycle_id=v_cycle.id and c.status='active';

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'placementId',cp.id,
           'objectId',cp.object_id,
           'objectKey',go.stable_key,
           'objectLabel',go.label,
           'placementMode',cp.placement_mode,
           'placementLabel',cp.placement_label,
           'explicitPlantCount',cp.explicit_plant_count,
           'confidence',cp.confidence,
           'plantingClaimId',cp.planting_claim_id
         )) order by go.label,cp.id),'[]'::jsonb)
  into v_placement_count,v_placements
  from atlas.crop_placements cp
  join atlas.growing_objects go on go.id=cp.object_id
  where cp.crop_cycle_id=v_cycle.id;

  select jsonb_strip_nulls(jsonb_build_object(
           'taskId',t.id,'title',t.title,'taskType',t.task_type,'status',t.status,
           'dueDate',t.due_date,'visibilityScope',t.visibility_scope,'operationClass',t.operation_class,
           'reason',t.metadata->>'resolution_reason'
         ))
  into v_resolution
  from atlas.task_crop_cycles tc
  join atlas.tasks t on t.id=tc.task_id
  where tc.crop_cycle_id=v_cycle.id
    and t.status in ('open','blocked')
    and t.task_type in ('spatial_destination_resolution','spatial_destination_reconciliation')
  order by t.due_date nulls last,t.created_at
  limit 1;

  if jsonb_typeof(coalesce(v_cycle.metadata,'{}'::jsonb)->'destination_object_ids')='array' then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'destinationObjectId',go.id,'destinationObjectKey',go.stable_key,'destinationLabel',go.label,
             'evidenceClass','legacy_metadata_candidate'
           )) order by go.label),'[]'::jsonb)
    into v_legacy
    from jsonb_array_elements_text(v_cycle.metadata->'destination_object_ids') x(raw)
    join atlas.growing_objects go on go.farm_id=v_cycle.farm_id and go.id::text=x.raw;
  end if;

  if v_placement_count>0 then
    v_state:='placed'; v_destination_warrant:=true;
  elsif v_claim_count>0 then
    v_state:='claimed'; v_destination_warrant:=true;
  elsif v_resolution is not null then
    v_state:='resolution_path_open'; v_destination_warrant:=false;
  else
    v_state:='unresolved_without_path'; v_destination_warrant:=false;
  end if;

  return jsonb_build_object(
    'contractVersion','crop_spatial_destination_reality_expression_v1',
    'subject',jsonb_strip_nulls(jsonb_build_object(
      'cropCycleId',v_cycle.id,'cropCycleKey',v_cycle.crop_cycle_key,'cropLabel',v_cycle.crop_label,
      'variety',v_cycle.variety,'cycleState',v_cycle.cycle_state,'lifecycleStatus',v_cycle.lifecycle_status
    )),
    'currentLocation',jsonb_strip_nulls(jsonb_build_object(
      'objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,'zoneKey',v_zone_key
    )),
    'destination',jsonb_build_object(
      'state',v_state,
      'destinationWarrantEstablished',v_destination_warrant,
      'activeClaims',v_claims,
      'currentPlacements',v_placements,
      'resolutionPath',v_resolution,
      'legacyCandidateDestinations',v_legacy
    ),
    'releaseBoundary',jsonb_build_object(
      'spatialReleaseAllowed',v_destination_warrant,
      'principle','A future destination claim is not current occupancy. Metadata-only destinations are evidence candidates, not canonical claims. A ready body without a lawful destination remains blocked unless an explicit destination-resolution path exists.'
    ),
    'truthBoundary',jsonb_build_object(
      'claimIsNotOccupancy',true,
      'claimIsNotDestinationReadiness',true,
      'metadataCandidateIsNotCanonicalClaim',true,
      'noDestinationNoConfidentRelease',true,
      'resolutionPathDoesNotEqualRelease',true
    )
  );
end;
$function$;

revoke all on function atlas.crop_spatial_destination_reality_expression_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.crop_spatial_destination_reality_expression_v1(uuid) to service_role;

create or replace function atlas.ensure_crop_destination_resolution_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_existing atlas.tasks%rowtype;
  v_task atlas.tasks%rowtype;
  v_claim_count integer:=0;
  v_placement_count integer:=0;
  v_allocated numeric:=null;
  v_done_target numeric:=0;
  v_task_type text;
  v_title text;
  v_reason text;
  v_due date;
  v_role text;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id for update;
  if v_cycle.id is null then raise exception 'Crop cycle was not found.' using errcode='P0002'; end if;
  if coalesce(v_cycle.lifecycle_status,'active')<>'active' then
    return jsonb_build_object('cropCycleId',v_cycle.id,'state','terminal_no_resolution_needed','created',false);
  end if;

  select count(*) into v_claim_count from atlas.crop_destination_claims where crop_cycle_id=v_cycle.id and status='active';
  select count(*) into v_placement_count from atlas.crop_placements where crop_cycle_id=v_cycle.id;
  if v_claim_count>0 or v_placement_count>0 then
    return jsonb_build_object('cropCycleId',v_cycle.id,'state',case when v_placement_count>0 then 'placed' else 'claimed' end,'created',false);
  end if;

  select t.* into v_existing
  from atlas.task_crop_cycles tc join atlas.tasks t on t.id=tc.task_id
  where tc.crop_cycle_id=v_cycle.id and t.status in ('open','blocked')
    and t.task_type in ('spatial_destination_resolution','spatial_destination_reconciliation')
  order by t.created_at limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('cropCycleId',v_cycle.id,'state','resolution_path_open','taskId',v_existing.id,'created',false);
  end if;

  begin v_allocated:=nullif(v_cycle.metadata->>'allocated_seedlings','')::numeric; exception when others then v_allocated:=null; end;
  select coalesce(sum(coalesce(nullif(t.metadata->>'quantity','')::numeric,nullif(t.metadata->>'total_quantity','')::numeric,0)),0)
  into v_done_target
  from atlas.task_crop_cycles tc join atlas.tasks t on t.id=tc.task_id
  where tc.crop_cycle_id=v_cycle.id and t.status='done' and t.task_type='transplanting';

  if v_allocated is not null and v_allocated>0 and v_done_target>=v_allocated then
    v_task_type:='spatial_destination_reconciliation';
    v_title:='Inspect remaining transplant stock — '||coalesce(v_cycle.variety,v_cycle.crop_label);
    v_reason:='Older completed transplant cards account for the recorded allocated cohort, but task completion alone does not prove the source body is empty. Inspect remaining material before reclassifying or assigning more destinations.';
    v_role:='observes';
  else
    v_task_type:='spatial_destination_resolution';
    v_title:='Resolve transplant destination — '||coalesce(v_cycle.variety,v_cycle.crop_label);
    v_reason:='This living crop body is at a move-ready/hardening stage but has no canonical destination claim. Assign a lawful destination or explicitly decide that it should wait, be repaired, or terminate.';
    v_role:='prerequisite';
  end if;

  begin v_due:=nullif(v_cycle.metadata->>'planned_transplant_date','')::date; exception when others then v_due:=null; end;
  v_due:=greatest((now() at time zone 'America/Chicago')::date,coalesce(v_due,(now() at time zone 'America/Chicago')::date));

  insert into atlas.tasks(
    farm_id,title,task_type,status,priority,due_date,generated_from,generated_from_id,note,metadata,
    action_key,operation_class,work_class,task_series_key,engine_instance_key,visibility_scope
  ) values (
    v_cycle.farm_id,v_title,v_task_type,'open','high',v_due,'crop_cycle_destination',v_cycle.id,v_reason,
    jsonb_build_object(
      'task_style',v_task_type,'source_crop_cycle_id',v_cycle.id,'crop_label',v_cycle.crop_label,'variety',v_cycle.variety,
      'source_cycle_state',v_cycle.cycle_state,'resolution_reason',v_reason,'repair_owner','farm_operations_management',
      'destination_claim_required',v_task_type='spatial_destination_resolution','physical_reconciliation_required',v_task_type='spatial_destination_reconciliation',
      'prior_done_transplant_target_quantity',v_done_target,'recorded_allocated_seedlings',v_allocated,
      'principal_escalation_created',false,'display_action',case when v_task_type='spatial_destination_resolution' then 'Resolve destination' else 'Inspect remaining stock' end,
      'display_subject',coalesce(v_cycle.variety,v_cycle.crop_label),'display_detail',v_reason
    ),
    case when v_task_type='spatial_destination_resolution' then 'resolve_destination' else 'inspect' end,
    'inspect_assess','standard','crop-cycle:'||v_cycle.id::text||':spatial-destination',
    'crop-spatial-destination:'||v_cycle.id::text,'management'
  ) returning * into v_task;

  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values(v_task.id,v_cycle.id,v_role,'confirmed','crop_spatial_destination_v1',jsonb_build_object('task_type',v_task_type))
  on conflict do nothing;

  return jsonb_build_object('cropCycleId',v_cycle.id,'state','resolution_path_open','taskId',v_task.id,'taskType',v_task_type,'created',true);
end;
$function$;

revoke all on function atlas.ensure_crop_destination_resolution_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.ensure_crop_destination_resolution_v1(uuid) to service_role;

create or replace function atlas.task_execution_destination_readiness_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_zone_key text;
  v_operation text;
  v_type text;
  v_destination_id uuid;
  v_destination_exists boolean:=false;
  v_destination_text text;
  v_state text;
  v_ready boolean;
  v_reason text;
  v_source text;
  v_gate atlas.production_transplant_gates%rowtype;
  v_cycle_count integer:=0;
  v_claimed_cycle_count integer:=0;
  v_resolution_count integer:=0;
  v_claims jsonb:='[]'::jsonb;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  select z.stable_key into v_zone_key from atlas.zones z where z.id=v_task.zone_id;
  v_operation:=lower(coalesce(v_task.operation_class,''));
  v_type:=lower(coalesce(v_task.task_type,''));
  v_destination_text:=nullif(btrim(coalesce(v_task.metadata->>'transplant_destination',v_task.metadata->>'destination_label',v_task.metadata->>'execution_destination','')),'');

  begin
    v_destination_id:=nullif(coalesce(v_task.metadata->>'destination_object_id',v_task.metadata->>'transplant_destination_object_id',v_task.metadata->>'target_object_id'),'')::uuid;
  exception when others then v_destination_id:=null; end;
  if v_destination_id is not null then
    select exists(select 1 from atlas.growing_objects go where go.id=v_destination_id and go.farm_id=v_task.farm_id) into v_destination_exists;
  end if;

  if v_type='production_transplant' then
    select * into v_gate from atlas.production_transplant_gates where id=v_task.generated_from_id and farm_id=v_task.farm_id;
    if v_gate.id is not null and v_gate.gate_status='ready' then
      v_state:='ready'; v_ready:=true; v_source:='production_transplant_gate';
    else
      v_state:='destination_required'; v_ready:=false; v_source:='production_transplant_gate';
      v_reason:=coalesce(v_gate.blocker_text,'Production transplant requires a ready native transplant gate with assigned and prepared bed capacity.');
    end if;
  elsif v_type<>'transplanting' then
    v_state:='not_applicable'; v_ready:=true; v_source:='task_type';
  elsif v_operation not in ('establish_aboveground','establish_belowground','divide_reestablish_belowground') then
    v_state:='not_applicable'; v_ready:=true; v_source:='operation_class';
  elsif v_destination_exists then
    v_state:='ready'; v_ready:=true; v_source:='destination_object';
  else
    with cycle_ids as (
      select tc.crop_cycle_id as id from atlas.task_crop_cycles tc where tc.task_id=v_task.id
      union
      select x.raw::uuid from jsonb_array_elements_text(case when jsonb_typeof(v_task.metadata->'crop_cycle_ids')='array' then v_task.metadata->'crop_cycle_ids' else '[]'::jsonb end) x(raw)
      where x.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      union
      select nullif(v_task.metadata->>'source_crop_cycle_id','')::uuid where coalesce(v_task.metadata->>'source_crop_cycle_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      union
      select nullif(v_task.metadata->>'canonical_crop_cycle_id','')::uuid where coalesce(v_task.metadata->>'canonical_crop_cycle_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ), valid_cycles as (
      select distinct cc.id from cycle_ids c join atlas.crop_cycles cc on cc.id=c.id and cc.farm_id=v_task.farm_id and coalesce(cc.lifecycle_status,'active')='active'
    ), eval as (
      select vc.id,
        exists(select 1 from atlas.crop_destination_claims dc where dc.crop_cycle_id=vc.id and dc.status='active') as has_claim,
        exists(select 1 from atlas.task_crop_cycles tc2 join atlas.tasks rt on rt.id=tc2.task_id where tc2.crop_cycle_id=vc.id and rt.status in ('open','blocked') and rt.task_type in ('spatial_destination_resolution','spatial_destination_reconciliation')) as has_resolution
      from valid_cycles vc
    )
    select count(*)::integer,
           count(*) filter(where has_claim)::integer,
           count(*) filter(where has_resolution)::integer
    into v_cycle_count,v_claimed_cycle_count,v_resolution_count
    from eval;

    if v_cycle_count>0 and v_claimed_cycle_count=v_cycle_count then
      v_state:='ready'; v_ready:=true; v_source:='crop_destination_claim';
      select coalesce(jsonb_agg(jsonb_build_object('cropCycleId',dc.crop_cycle_id,'claimId',dc.id,'destinationObjectId',dc.destination_object_id,'claimedQuantity',dc.claimed_quantity,'unit',dc.unit,'claimStrength',dc.claim_strength,'requiredBy',dc.required_by) order by dc.crop_cycle_id,dc.created_at),'[]'::jsonb)
      into v_claims
      from atlas.crop_destination_claims dc
      where dc.status='active' and dc.crop_cycle_id in (
        select tc.crop_cycle_id from atlas.task_crop_cycles tc where tc.task_id=v_task.id
        union
        select x.raw::uuid from jsonb_array_elements_text(case when jsonb_typeof(v_task.metadata->'crop_cycle_ids')='array' then v_task.metadata->'crop_cycle_ids' else '[]'::jsonb end) x(raw)
        where x.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      );
    elsif coalesce(v_zone_key,'')<>'grow_room' and v_task.zone_id is not null then
      v_state:='ready'; v_ready:=true; v_source:='canonical_execution_zone';
    else
      v_state:='destination_required'; v_ready:=false;
      v_source:=case when v_resolution_count>0 then 'destination_resolution_path' when v_zone_key='grow_room' then 'source_zone_only' else 'missing_destination_context' end;
      v_reason:=case
        when v_resolution_count>0 then 'A destination-resolution path exists, but no canonical destination claim has been established yet.'
        when v_destination_text is null then 'Final transplant work has no canonical destination object or crop destination claim.'
        when lower(v_destination_text) ~ '(choose|unknown|tbd|to be determined|at transplant time)' then 'Final transplant destination is explicitly unresolved.'
        else 'A text destination exists, but final transplant execution still needs a canonical destination object, crop destination claim, or non-source execution zone.'
      end;
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'contractVersion','task_execution_destination_readiness_v1','taskId',v_task.id,'state',v_state,'ready',v_ready,'reason',v_reason,'source',v_source,
    'operationClass',nullif(v_operation,''),'taskType',nullif(v_type,''),'taskZoneKey',v_zone_key,
    'destinationObjectId',v_destination_id,'destinationObjectExists',v_destination_exists,'destinationText',v_destination_text,
    'subjectCycleCount',v_cycle_count,'claimedSubjectCycleCount',v_claimed_cycle_count,'resolutionPathCount',v_resolution_count,'destinationClaims',v_claims,
    'truthBoundary',jsonb_build_object('metadataDestinationIsNotCanonicalClaim',true,'resolutionPathDoesNotEqualReady',true,'productionTransplantUsesNativeGate',true)
  ));
end;
$function$;

revoke all on function atlas.task_execution_destination_readiness_v1(uuid) from public,anon;