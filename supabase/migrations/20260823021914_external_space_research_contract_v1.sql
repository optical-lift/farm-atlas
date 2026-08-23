insert into local_intel.research_questions(
  stable_key,version,status,question_text,research_kind,target_object_kind,
  answer_contract,applicability_contract,success_criteria,metadata
)
select
  'external_space_use',1,'active',
  'Does this organization use, seek, rent, or otherwise rely on external gathering space, and for which governed use cases?',
  'external_space_use_resolution','entity',
  jsonb_build_object(
    'answer_type','structured_evidence_set',
    'truth_layer','organization_external_space_evidence',
    'canonical_output','external_space_use_profile',
    'evidence_is_not_fit_adjudication',true,
    'no_evidence_found_is_not_negative_proof',true
  ),
  jsonb_build_object('entity_types',jsonb_build_array('business','organization','nonprofit','government')),
  jsonb_build_object('sufficient_when',jsonb_build_array(
    'one or more attributable observations establish external, internal, or mixed gathering-space behavior at supported scope',
    'governed source routes are exhausted and an unresolved result records the checked scope and window',
    'the question is adjudicated not applicable'
  )),
  jsonb_build_object(
    'created_for','Elm Venue Pilot 01 market-fit research',
    'governing_principle','research organization behavior once; adjudicate each campaign use case separately'
  )
where not exists (
  select 1 from local_intel.research_questions where stable_key='external_space_use' and version=1
);

insert into local_intel.research_question_source_policies(
  research_question_id,version,status,durability_policy_id,evidence_requirement,
  freshness_contract,stop_rule,unresolved_behavior,metadata
)
select
  rq.id,1,'active',dp.id,
  jsonb_build_object(
    'preferred','dated first-party event, meeting, procurement, venue, or facility evidence tied to the organization',
    'secondary_rule','reputable independent reporting may establish a dated event or venue fact when organization identity and event attribution are clear',
    'social_rule','attributable public social evidence may establish a dated operational event but not a durable organization-wide venue preference by itself',
    'negative_rule','absence of external-space evidence is never converted into a claim that external space is not used'
  ),
  jsonb_build_object(
    'basis','durability_policy',
    'historical_event_rule','dated historical venue-use observations remain evidence of past behavior; current fit still requires scope-aware adjudication',
    'consequential_use','recheck if only old or weak evidence supports a current campaign decision'
  ),
  jsonb_build_object('stop_when',jsonb_build_array(
    'attributable evidence resolves at least one relevant gathering-space behavior and all materially conflicting evidence is recorded',
    'governed routes are exhausted and the attempt is explicitly unresolved with checked sources and queries',
    'question is not applicable'
  )),
  jsonb_build_object(
    'state','unresolved',
    'never_infer_no_external_use_from_no_search_result',true,
    'never_infer_use_case_fit_from_organization_level_venue_use_alone',true
  ),
  jsonb_build_object('policy_name','external_space_use_source_policy_v1')
from local_intel.research_questions rq
join local_intel.evidence_durability_policies dp on dp.stable_key='moderate_change' and dp.status='active'
where rq.stable_key='external_space_use' and rq.version=1
  and not exists (
    select 1 from local_intel.research_question_source_policies p where p.research_question_id=rq.id and p.version=1
  );

with p as (
  select p.id
  from local_intel.research_question_source_policies p
  join local_intel.research_questions rq on rq.id=p.research_question_id
  where rq.stable_key='external_space_use' and rq.version=1 and p.version=1
), routes(route_order,source_class_key,route_role,acceptance_mode,requires_current,max_source_age_hours) as (
  values
    (10,'first_party_official','primary','direct',false,null::integer),
    (20,'direct_provider','preferred','direct',false,null::integer),
    (25,'primary_authority','preferred','conditional',false,null::integer),
    (30,'transaction_platform','preferred','conditional',false,null::integer),
    (40,'reputable_secondary','fallback','conditional',false,null::integer),
    (50,'public_social','fallback','conditional',false,null::integer),
    (60,'current_directory','corroborating','corroborating_only',true,4320),
    (90,'discovery_only','discovery_only','discovery_only',false,null::integer)
)
insert into local_intel.research_question_source_routes(
  source_policy_id,source_class_id,route_order,route_role,acceptance_mode,requires_current,max_source_age_hours,metadata
)
select p.id,sc.id,r.route_order,r.route_role,r.acceptance_mode,r.requires_current,r.max_source_age_hours,
       jsonb_build_object('question_key','external_space_use')
from p cross join routes r
join local_intel.research_source_classes sc on sc.stable_key=r.source_class_key and sc.status='active'
where not exists (
  select 1 from local_intel.research_question_source_routes x
  where x.source_policy_id=p.id and x.source_class_id=sc.id and x.route_order=r.route_order
);

create table if not exists local_intel.organization_external_space_evidence (
  id uuid primary key default gen_random_uuid(),
  evidence_key text not null unique,
  entity_id uuid not null references local_intel.entities(id) on delete restrict,
  use_case_id uuid references local_intel.offering_use_cases(id) on delete restrict,
  space_mode text not null check (space_mode in ('external','internal','mixed','unknown')),
  evidence_kind text not null check (evidence_kind in ('observed_event_location','venue_booking_or_rental','venue_search_or_rfp','facility_inventory','explicit_space_preference','other')),
  evidence_effect text not null check (evidence_effect in ('supports_external_space_fit','supports_internal_self_supply','mixed_or_ambiguous','context_only')),
  observation_date date,
  source_id uuid not null references local_intel.sources(id) on delete restrict,
  research_attempt_id uuid references local_intel.research_attempts(id) on delete restrict,
  summary text not null check (length(btrim(summary))>0),
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists organization_external_space_evidence_entity_idx
  on local_intel.organization_external_space_evidence(entity_id,observed_at desc);
create index if not exists organization_external_space_evidence_use_case_idx
  on local_intel.organization_external_space_evidence(use_case_id,entity_id)
  where use_case_id is not null;
create index if not exists organization_external_space_evidence_source_idx
  on local_intel.organization_external_space_evidence(source_id);

create or replace function local_intel.block_organization_external_space_evidence_mutation_v1()
returns trigger language plpgsql set search_path to 'pg_catalog','local_intel' as $function$
begin
  raise exception 'organization external-space evidence is append-only; append new evidence instead';
end;
$function$;
drop trigger if exists organization_external_space_evidence_append_only_v1 on local_intel.organization_external_space_evidence;
create trigger organization_external_space_evidence_append_only_v1
before update or delete on local_intel.organization_external_space_evidence
for each row execute function local_intel.block_organization_external_space_evidence_mutation_v1();

create or replace function local_intel.record_organization_external_space_evidence_v1(p_payload jsonb)
returns uuid
language plpgsql security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  v_evidence_key text := nullif(btrim(p_payload->>'evidence_key'),'');
  v_entity_id uuid;
  v_use_case_id uuid;
  v_source_id uuid;
  v_attempt_id uuid;
  v_space_mode text := nullif(btrim(p_payload->>'space_mode'),'');
  v_evidence_kind text := nullif(btrim(p_payload->>'evidence_kind'),'');
  v_evidence_effect text := nullif(btrim(p_payload->>'evidence_effect'),'');
  v_summary text := nullif(btrim(p_payload->>'summary'),'');
  v_observation_date date;
  v_id uuid;
  v_existing local_intel.organization_external_space_evidence%rowtype;
  v_admissible boolean;
begin
  if v_evidence_key is null then raise exception 'evidence_key is required'; end if;
  begin v_entity_id := (p_payload->>'entity_id')::uuid; exception when others then raise exception 'entity_id must be UUID'; end;
  if nullif(p_payload->>'use_case_id','') is not null then
    begin v_use_case_id := (p_payload->>'use_case_id')::uuid; exception when others then raise exception 'use_case_id must be UUID'; end;
  end if;
  begin v_source_id := (p_payload->>'source_id')::uuid; exception when others then raise exception 'source_id must be UUID'; end;
  if nullif(p_payload->>'research_attempt_id','') is not null then
    begin v_attempt_id := (p_payload->>'research_attempt_id')::uuid; exception when others then raise exception 'research_attempt_id must be UUID'; end;
  end if;
  if nullif(p_payload->>'observation_date','') is not null then
    begin v_observation_date := (p_payload->>'observation_date')::date; exception when others then raise exception 'observation_date must be date'; end;
  end if;
  if v_space_mode not in ('external','internal','mixed','unknown') then raise exception 'invalid space_mode'; end if;
  if v_evidence_kind not in ('observed_event_location','venue_booking_or_rental','venue_search_or_rfp','facility_inventory','explicit_space_preference','other') then raise exception 'invalid evidence_kind'; end if;
  if v_evidence_effect not in ('supports_external_space_fit','supports_internal_self_supply','mixed_or_ambiguous','context_only') then raise exception 'invalid evidence_effect'; end if;
  if v_summary is null then raise exception 'summary is required'; end if;
  if not exists(select 1 from local_intel.entities where id=v_entity_id) then raise exception 'unknown entity %',v_entity_id; end if;
  if v_use_case_id is not null and not exists(select 1 from local_intel.offering_use_cases where id=v_use_case_id) then raise exception 'unknown use_case %',v_use_case_id; end if;
  if not exists(select 1 from local_intel.sources where id=v_source_id) then raise exception 'unknown source %',v_source_id; end if;
  if v_attempt_id is not null and not exists(select 1 from local_intel.research_attempts where id=v_attempt_id and entity_id=v_entity_id) then
    raise exception 'research_attempt_id must belong to entity';
  end if;

  select currently_admissible into v_admissible
  from local_intel.v_research_source_question_admissibility_v1
  where source_id=v_source_id and research_question_key='external_space_use'
  limit 1;
  if coalesce(v_admissible,false)=false then
    raise exception 'source % is not currently admissible for external_space_use research',v_source_id;
  end if;

  select * into v_existing from local_intel.organization_external_space_evidence where evidence_key=v_evidence_key;
  if found then
    if v_existing.entity_id is distinct from v_entity_id
       or v_existing.use_case_id is distinct from v_use_case_id
       or v_existing.source_id is distinct from v_source_id
       or v_existing.space_mode is distinct from v_space_mode
       or v_existing.evidence_kind is distinct from v_evidence_kind
       or v_existing.evidence_effect is distinct from v_evidence_effect
       or v_existing.summary is distinct from v_summary then
      raise exception 'evidence_key % already belongs to different immutable evidence',v_evidence_key;
    end if;
    return v_existing.id;
  end if;

  insert into local_intel.organization_external_space_evidence(
    evidence_key,entity_id,use_case_id,space_mode,evidence_kind,evidence_effect,observation_date,
    source_id,research_attempt_id,summary,metadata,observed_at
  ) values (
    v_evidence_key,v_entity_id,v_use_case_id,v_space_mode,v_evidence_kind,v_evidence_effect,v_observation_date,
    v_source_id,v_attempt_id,v_summary,coalesce(p_payload->'metadata','{}'::jsonb),
    coalesce(nullif(p_payload->>'observed_at','')::timestamptz,now())
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace view local_intel.v_campaign_external_space_target_evidence_v1 as
select
  ct.id campaign_target_id,
  ct.campaign_id,
  ct.organization_entity_id,
  e.name organization_name,
  ct.offering_use_case_id,
  uc.stable_key use_case_key,
  uc.name use_case_name,
  ct.segment_id,
  cs.name segment_name,
  ct.rank_score,
  ct.qualification_tier,
  ct.target_state,
  ct.venue_fit_readiness,
  ct.next_best_enrichment,
  count(ev.id) filter (where ev.evidence_effect='supports_external_space_fit' and ev.use_case_id=ct.offering_use_case_id) same_use_case_external_count,
  count(ev.id) filter (where ev.evidence_effect='supports_external_space_fit' and ev.use_case_id is null) organization_external_count,
  count(ev.id) filter (where ev.evidence_effect='supports_internal_self_supply' and ev.use_case_id=ct.offering_use_case_id) same_use_case_internal_count,
  count(ev.id) filter (where ev.evidence_effect='supports_internal_self_supply' and ev.use_case_id is null) organization_internal_count,
  coalesce(jsonb_agg(distinct ev.id) filter (where ev.id is not null),'[]'::jsonb) evidence_ids,
  case
    when count(ev.id) filter (where ev.evidence_effect='supports_external_space_fit' and ev.use_case_id=ct.offering_use_case_id)>0
      then 'use_case_external_evidence'
    when count(ev.id) filter (where ev.evidence_effect='supports_external_space_fit' and ev.use_case_id is null)>0
      and count(ev.id) filter (where ev.evidence_effect='supports_internal_self_supply' and ev.use_case_id=ct.offering_use_case_id)>0
      then 'organization_external_plus_use_case_internal_evidence'
    when count(ev.id) filter (where ev.evidence_effect='supports_external_space_fit' and ev.use_case_id is null)>0
      then 'organization_external_evidence_use_case_unresolved'
    when count(ev.id) filter (where ev.evidence_effect='supports_internal_self_supply' and (ev.use_case_id=ct.offering_use_case_id or ev.use_case_id is null))>0
      then 'internal_self_supply_evidence_only'
    when count(ev.id)>0 then 'context_evidence_only'
    else 'no_canonical_external_space_evidence'
  end derived_evidence_state,
  case
    when count(ev.id) filter (where ev.evidence_effect='supports_external_space_fit' and ev.use_case_id=ct.offering_use_case_id)>0
      then 'review_for_external_space_fit_supported'
    when count(ev.id) filter (where ev.evidence_effect='supports_external_space_fit' and ev.use_case_id is null)>0
      then 'adjudicate_use_case_scope'
    when count(ev.id) filter (where ev.evidence_effect='supports_internal_self_supply' and (ev.use_case_id=ct.offering_use_case_id or ev.use_case_id is null))>0
      then 'seek_exception_or_external_use_evidence'
    else 'continue_external_space_research'
  end recommended_adjudication
from local_intel.campaign_targets ct
join local_intel.entities e on e.id=ct.organization_entity_id
join local_intel.offering_use_cases uc on uc.id=ct.offering_use_case_id
left join local_intel.campaign_segments cs on cs.id=ct.segment_id
left join local_intel.organization_external_space_evidence ev on ev.entity_id=ct.organization_entity_id
  and (ev.use_case_id is null or ev.use_case_id=ct.offering_use_case_id)
group by ct.id,ct.campaign_id,ct.organization_entity_id,e.name,ct.offering_use_case_id,uc.stable_key,uc.name,
         ct.segment_id,cs.name,ct.rank_score,ct.qualification_tier,ct.target_state,ct.venue_fit_readiness,ct.next_best_enrichment;

create or replace view local_intel.v_campaign_external_space_research_queue_v1 as
with targets as (
  select tev.*
  from local_intel.v_campaign_external_space_target_evidence_v1 tev
  where tev.next_best_enrichment in ('external_space_fit_enrichment','external_space_exception_check')
), grouped as (
  select campaign_id,organization_entity_id,organization_name,
         count(*) target_count,
         max(rank_score) max_rank_score,
         jsonb_agg(campaign_target_id order by rank_score desc) target_ids,
         jsonb_agg(jsonb_build_object('use_case_id',offering_use_case_id,'use_case_key',use_case_key,'use_case_name',use_case_name,'segment',segment_name,'rank_score',rank_score,'current_fit',venue_fit_readiness,'derived_evidence_state',derived_evidence_state,'recommended_adjudication',recommended_adjudication) order by rank_score desc) target_contexts,
         count(*) filter (where derived_evidence_state<>'no_canonical_external_space_evidence') targets_with_evidence
  from targets
  group by campaign_id,organization_entity_id,organization_name
)
select g.*,
       rq.id research_question_id,
       rq.stable_key research_question_key,
       la.research_attempt_id latest_attempt_id,
       la.attempted_at latest_attempted_at,
       la.outcome latest_attempt_outcome,
       la.evidence_effect latest_attempt_evidence_effect,
       la.finding_summary latest_attempt_summary,
       la.revisit_after,
       qg.id question_gap_id,
       qg.status question_gap_status,
       case
         when g.targets_with_evidence>0 then 'evidence_present_needs_target_adjudication'
         when la.revisit_after is not null and la.revisit_after>now() then 'recent_unresolved_wait'
         else 'research_needed'
       end queue_state,
       case
         when g.targets_with_evidence>0 then 'adjudicate_target_use_case_fit_from_canonical_evidence'
         when la.revisit_after is not null and la.revisit_after>now() then 'wait_until_revisit_or_new_material_evidence'
         else 'execute_external_space_use_research_contract'
       end next_action
from grouped g
join local_intel.research_questions rq on rq.stable_key='external_space_use' and rq.version=1 and rq.status='active'
left join lateral (
  select * from local_intel.v_latest_scoped_research_attempt_v1 x
  where x.entity_id=g.organization_entity_id and x.research_kind='external_space_use_resolution'
    and x.offering_id is null and x.use_case_id is null
  limit 1
) la on true
left join lateral (
  select q.* from local_intel.question_gaps q
  where q.entity_id=g.organization_entity_id and q.question_key='external_space_use'
    and q.metadata->>'campaign_id'=g.campaign_id::text
  order by q.created_at desc limit 1
) qg on true;

create or replace function local_intel.sync_campaign_external_space_research_gaps_v1(p_campaign_id uuid)
returns integer
language plpgsql security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare v_inserted integer;
begin
  insert into local_intel.question_gaps(
    question_key,object_type,entity_id,gap_kind,priority,status,reason,recommended_acquisition,metadata
  )
  select
    'external_space_use','entity',q.organization_entity_id,'external_space_fit_missing',
    greatest(1,least(5,ceil(coalesce(q.max_rank_score,0)/30.0)::integer)),
    'open',
    format('%s campaign target row(s) require external-space-use evidence before venue-fit adjudication.',q.target_count),
    'governed_external_space_research',
    jsonb_build_object(
      'campaign_id',q.campaign_id,
      'target_ids',q.target_ids,
      'target_contexts',q.target_contexts,
      'dedupe_scope','organization_once_then_use_case_adjudication',
      'created_by','sync_campaign_external_space_research_gaps_v1'
    )
  from local_intel.v_campaign_external_space_research_queue_v1 q
  where q.campaign_id=p_campaign_id and q.question_gap_id is null
    and q.queue_state='research_needed';
  get diagnostics v_inserted=row_count;
  return v_inserted;
end;
$function$;

revoke all on local_intel.organization_external_space_evidence from public,anon,authenticated,service_role;
grant select on local_intel.organization_external_space_evidence to service_role;
revoke all on local_intel.v_campaign_external_space_target_evidence_v1 from public,anon,authenticated;
revoke all on local_intel.v_campaign_external_space_research_queue_v1 from public,anon,authenticated;
grant select on local_intel.v_campaign_external_space_target_evidence_v1 to service_role;
grant select on local_intel.v_campaign_external_space_research_queue_v1 to service_role;
revoke execute on function local_intel.block_organization_external_space_evidence_mutation_v1() from public,anon,authenticated,service_role;
revoke execute on function local_intel.record_organization_external_space_evidence_v1(jsonb) from public,anon,authenticated;
grant execute on function local_intel.record_organization_external_space_evidence_v1(jsonb) to service_role;
revoke execute on function local_intel.sync_campaign_external_space_research_gaps_v1(uuid) from public,anon,authenticated;
grant execute on function local_intel.sync_campaign_external_space_research_gaps_v1(uuid) to service_role;