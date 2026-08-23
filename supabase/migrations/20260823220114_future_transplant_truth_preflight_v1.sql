create or replace function atlas.crop_cycle_future_transplant_preflight_v1(
  p_crop_cycle_id uuid,
  p_as_of_date date default null,
  p_horizon_days integer default 42,
  p_acquisition_lead_days integer default 14
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_day date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_occ atlas.planned_work_occurrences%rowtype;
  v_work_date date;
  v_destination jsonb;
  v_targets jsonb:='[]'::jsonb;
  v_target_count integer:=0;
  v_preflight_due boolean:=false;
  v_current_requirement_active boolean:=false;
begin
  if p_crop_cycle_id is null then raise exception 'Crop cycle is required.' using errcode='22023'; end if;
  if p_horizon_days<1 or p_horizon_days>180 then raise exception 'Future truth horizon must be between 1 and 180 days.' using errcode='22023'; end if;
  if p_acquisition_lead_days<0 or p_acquisition_lead_days>p_horizon_days then raise exception 'Acquisition lead must be within the future truth horizon.' using errcode='22023'; end if;

  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;

  select pwo.* into v_occ
  from atlas.planned_work_occurrences pwo
  where pwo.farm_id=v_cycle.farm_id
    and pwo.state in ('planned','eligible','released')
    and coalesce(pwo.planned_due_date,pwo.earliest_lawful_date,pwo.preferred_start_date)
        between v_day and v_day+p_horizon_days
    and coalesce(pwo.task_payload->>'task_type','')='transplanting'
    and (
      exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof(pwo.task_payload->'metadata'->'crop_cycle_ids')='array'
               then pwo.task_payload->'metadata'->'crop_cycle_ids' else '[]'::jsonb end
        ) x(value)
        where x.value=v_cycle.id::text
      )
      or exists (
        select 1
        from jsonb_array_elements(
          case when jsonb_typeof(pwo.relation_payload->'task_crop_cycles')='array'
               then pwo.relation_payload->'task_crop_cycles' else '[]'::jsonb end
        ) x(value)
        where x.value->>'crop_cycle_id'=v_cycle.id::text
      )
    )
  order by coalesce(pwo.planned_due_date,pwo.earliest_lawful_date,pwo.preferred_start_date),pwo.created_at,pwo.id
  limit 1;

  if v_occ.id is null then
    return jsonb_build_object(
      'contractVersion','crop_cycle_future_transplant_preflight_v1',
      'cropCycleId',v_cycle.id,
      'futureOperationPlanned',false,
      'horizonDays',p_horizon_days,
      'acquisitionLeadDays',p_acquisition_lead_days,
      'asOfDate',v_day,
      'truthBoundary',jsonb_build_object(
        'noFutureOccurrenceDoesNotCreateRequirement',true,
        'planningEvidenceDoesNotBecomeCurrentFarmState',true
      )
    );
  end if;

  v_work_date:=coalesce(v_occ.planned_due_date,v_occ.earliest_lawful_date,v_occ.preferred_start_date);
  v_destination:=atlas.crop_destination_claim_coverage_v1(v_cycle.id);
  v_current_requirement_active:=coalesce(v_cycle.lifecycle_status,'active')='active'
    and v_cycle.cycle_state='hardening_off'
    and v_cycle.planted_date is null;

  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'objectId',candidate.object_id,
           'label',go.label,
           'stableKey',go.stable_key,
           'source',candidate.source
         )) filter(where candidate.object_id is not null),'[]'::jsonb),
         count(distinct candidate.object_id)::integer
    into v_targets,v_target_count
  from (
    select nullif(x.value->>'object_id','')::uuid as object_id,'planned_work_relation'::text as source
    from jsonb_array_elements(
      case when jsonb_typeof(v_occ.relation_payload->'task_objects')='array'
           then v_occ.relation_payload->'task_objects' else '[]'::jsonb end
    ) x(value)
    where x.value->>'role'='target'
    union all
    select nullif(x.value,'')::uuid,'task_payload_metadata'::text
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_occ.task_payload->'metadata'->'target_object_ids')='array'
           then v_occ.task_payload->'metadata'->'target_object_ids' else '[]'::jsonb end
    ) x(value)
  ) candidate
  left join atlas.growing_objects go on go.id=candidate.object_id and go.farm_id=v_cycle.farm_id;

  v_preflight_due:=not v_current_requirement_active
    and coalesce(v_destination->>'coverageState','missing')='missing'
    and v_work_date<=v_day+p_acquisition_lead_days;

  return jsonb_build_object(
    'contractVersion','crop_cycle_future_transplant_preflight_v1',
    'cropCycleId',v_cycle.id,
    'futureOperationPlanned',true,
    'futureOperationKind','transplant',
    'futureOperationOccurrenceId',v_occ.id,
    'futureOperationDate',v_work_date,
    'daysUntilOperation',v_work_date-v_day,
    'horizonDays',p_horizon_days,
    'acquisitionLeadDays',p_acquisition_lead_days,
    'acquisitionWindowOpensOn',v_work_date-p_acquisition_lead_days,
    'acquisitionWindowOpen',(v_work_date<=v_day+p_acquisition_lead_days),
    'currentTransplantRequirementActive',v_current_requirement_active,
    'destinationCoverageState',v_destination->>'coverageState',
    'destinationReleaseAllowed',coalesce((v_destination->>'spatialReleaseAllowed')::boolean,false),
    'transplantDestinationPreflightDue',v_preflight_due,
    'possibleTargetEvidence',v_targets,
    'possibleTargetEvidenceCount',v_target_count,
    'truthBoundary',jsonb_build_object(
      'futureOccurrenceIsPlanningEvidenceNotCurrentRequirement',true,
      'plannedTargetObjectsAreEvidenceNotCanonicalDestinationTruth',true,
      'canonicalDestinationClaimsSuppressPreflightAsk',true,
      'currentRequirementSupersedesFuturePreflight',true,
      'schedulingDoesNotCreateOperationalTruth',true
    )
  );
end;
$function$;

create or replace function atlas.crop_cycle_requirement_snapshot_v1(p_crop_cycle_id uuid, p_as_of_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_base jsonb;
  v_future jsonb;
begin
  -- Preserve the existing canonical current-reality snapshot unchanged, then add
  -- a separately named planning-evidence preflight block.
  v_base:=atlas.crop_cycle_requirement_snapshot_pre_future_truth_v1(p_crop_cycle_id,p_as_of_date);
  v_future:=atlas.crop_cycle_future_transplant_preflight_v1(p_crop_cycle_id,p_as_of_date,42,14);
  return v_base||jsonb_build_object('futureTruthPreflight',v_future);
end;
$function$;

revoke all on function atlas.crop_cycle_future_transplant_preflight_v1(uuid,date,integer,integer) from public,anon,authenticated;
grant execute on function atlas.crop_cycle_future_transplant_preflight_v1(uuid,date,integer,integer) to service_role;
revoke all on function atlas.crop_cycle_requirement_snapshot_v1(uuid,date) from public,anon;
grant execute on function atlas.crop_cycle_requirement_snapshot_v1(uuid,date) to authenticated,service_role;

insert into atlas.state_consequence_policies(
  farm_id,stable_key,subject_kind,subject_selector,state_match,consequence_kind,action_key,audience,priority,action_spec,active,metadata
)
values(
  null,
  'crop-future-transplant-destination-truth-preflight-v1',
  'crop_cycle',
  '{}'::jsonb,
  jsonb_build_object('futureTruthPreflight',jsonb_build_object('transplantDestinationPreflightDue',true)),
  'knowledge_acquisition',
  'choose_transplant_destination',
  'owner',
  18,
  jsonb_build_object(
    'state','future_truth_acquisition_required',
    'action','choose_transplant_destination',
    'factNeeded','lawful transplant destination',
    'actionLabel','Choose where to plant it',
    'jurisdiction','owner',
    'acquisitionLeadDays',14,
    'futureHorizonDays',42,
    'doesNotCreateCurrentRequirement',true
  ),
  true,
  jsonb_build_object(
    'gapKind','future_destination_required',
    'contract','future_truth_preflight_v1',
    'jurisdiction','owner',
    'knowerClass','owner_known',
    'consequenceRole','truth_acquisition',
    'acquisitionPhase','future_preflight',
    'searchAdapter','canonical_crop_destination_claim',
    'carrierContract','owner_knowledge_surface_only',
    'futureOccurrenceIsEvidenceOnly',true,
    'currentRequirementSupersedesPreflight',true
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
  active=excluded.active,
  metadata=excluded.metadata,
  updated_at=now();

create or replace function atlas.sync_truth_acquisition_carrier_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_knower jsonb;
  v_policy atlas.state_consequence_policies%rowtype;
begin
  if new.status='open' and new.consequence_role='truth_acquisition' then
    select * into v_policy from atlas.state_consequence_policies where id=new.policy_id;
    v_knower:=atlas.truth_acquisition_knower_v1(new.id);
    update atlas.state_consequence_instances
    set epistemic_basis=coalesce(epistemic_basis,'{}'::jsonb)||jsonb_build_object(
      'knowledgeAcquisitionSearch',v_knower->'search',
      'knowerClass',v_knower->>'knowerClass',
      'acquisitionSurface',v_knower->>'acquisitionSurface',
      'acquisitionPhase',coalesce(v_policy.metadata->>'acquisitionPhase','active_requirement'),
      'classifiedBy','truth_acquisition_knower_v1'
    ),updated_at=now()
    where id=new.id;

    if coalesce(v_policy.metadata->>'acquisitionPhase','active_requirement')='future_preflight' then
      -- Owner knowledge surface reads the consequence directly. Do not create/adopt
      -- a task whose wording could imply the future operation is already required now.
      return new;
    end if;

    if v_knower->>'acquisitionSurface' in ('atlas_needs_from_you','management_acquisition') then
      perform atlas.ensure_truth_acquisition_task_v1(new.id);
    elsif v_knower->>'acquisitionSurface'='worker_observation' then
      perform atlas.ensure_truth_acquisition_worker_observation_v1(new.id);
    end if;
  end if;
  return new;
exception when others then return new;
end;
$function$;

create or replace function atlas.owner_needs_from_you_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_user_id uuid:=auth.uid();
  v_cards jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required.' using errcode='42501'; end if;

  select coalesce(jsonb_agg(card order by priority desc, released_at, instance_id),'[]'::jsonb)
    into v_cards
  from (
    select i.id as instance_id,i.priority,i.released_at,
           jsonb_strip_nulls(jsonb_build_object(
             'contractVersion','atlas_needs_from_you_card_v1',
             'instanceId',i.id,'sourceRequirementInstanceId',i.source_requirement_instance_id,
             'farmId',i.farm_id,'subjectKind',i.subject_kind,'subjectId',i.subject_id,
             'actionKey',i.action_key,'priority',i.priority,'releasedAt',i.released_at,'carrierTaskId',i.carrier_task_id,
             'title',coalesce(t.metadata->>'display_subject',t.title,nullif(cc.variety,''),nullif(cc.crop_label,''),'Atlas needs a decision'),
             'detail',coalesce(
               t.metadata->>'display_detail',t.note,
               case when p.metadata->>'acquisitionPhase'='future_preflight'
                    then coalesce(nullif(cc.variety,''),nullif(cc.crop_label,''),'This crop')||' has future transplant work planned, but Atlas does not yet have a canonical destination.' end
             ),
             'actionLabel',coalesce(p.action_spec->>'actionLabel',t.metadata->>'display_action','Answer'),
             'factNeeded',p.action_spec->>'factNeeded','gapKind',p.metadata->>'gapKind',
             'acquisitionPhase',coalesce(p.metadata->>'acquisitionPhase','active_requirement'),
             'futureTruthPreflight',case when p.metadata->>'acquisitionPhase'='future_preflight' then i.state_snapshot->'futureTruthPreflight' end,
             'possibleEvidence',case when p.metadata->>'acquisitionPhase'='future_preflight' then i.state_snapshot->'futureTruthPreflight'->'possibleTargetEvidence' end,
             'knower',k.packet,
             'controls',case when i.action_key='choose_transplant_destination' then jsonb_build_array('choose_known_option','i_do_not_know') else jsonb_build_array('answer','not_applicable','i_do_not_know') end,
             'truthBoundary',jsonb_build_object(
               'notAnOverdueTaskList',true,'questionSurvivedSearchBeforeAsk',true,'answerMustResolveCanonicalTruthNotDismissCard',true,
               'futurePreflightDoesNotDeclareCurrentRequirement',true
             )
           )) as card
    from atlas.state_consequence_instances i
    join atlas.state_consequence_policies p on p.id=i.policy_id
    join atlas.farm_memberships fm on fm.farm_id=i.farm_id and fm.user_id=v_user_id and fm.active and fm.role='owner'
    left join atlas.tasks t on t.id=i.carrier_task_id
    left join atlas.crop_cycles cc on i.subject_kind='crop_cycle' and cc.id=i.subject_id
    cross join lateral (select atlas.truth_acquisition_knower_v1(i.id) as packet) k
    where i.status='open' and i.consequence_role='truth_acquisition' and k.packet->>'acquisitionSurface'='atlas_needs_from_you'
  ) q;

  return jsonb_build_object(
    'contractVersion','owner_needs_from_you_v1','userId',v_user_id,'count',jsonb_array_length(v_cards),'cards',v_cards,
    'truthBoundary',jsonb_build_object(
      'surfaceContainsOnlyOpenOwnerKnownGaps',true,'authoritativeAnswersAreSuppressed',true,'tasksRemainCarriersNotReality',true,
      'futurePreflightCardsArePlanningTruthAcquisitionNotCurrentRequirements',true
    )
  );
end;
$function$;

revoke all on function atlas.sync_truth_acquisition_carrier_v1() from public,anon,authenticated;
grant execute on function atlas.sync_truth_acquisition_carrier_v1() to service_role;
revoke all on function atlas.owner_needs_from_you_v1() from public,anon;
grant execute on function atlas.owner_needs_from_you_v1() to authenticated,service_role;

comment on function atlas.crop_cycle_future_transplant_preflight_v1(uuid,date,integer,integer) is
'Tranche 1F future truth preflight. Uses legitimate planned transplant occurrences as evidence that destination truth will be needed, but only canonical destination claims satisfy the fact. Planning evidence never creates the current transplant requirement.';