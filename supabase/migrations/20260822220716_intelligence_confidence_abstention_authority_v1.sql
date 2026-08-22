create table if not exists local_intel.intelligence_competence_domains (
  stable_key text primary key,
  label text not null,
  description text not null,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists local_intel.intelligence_decision_domain_map (
  id uuid primary key default gen_random_uuid(),
  decision_kind text not null,
  prediction_kind text not null,
  domain_key text not null references local_intel.intelligence_competence_domains(stable_key) on delete restrict,
  priority integer not null default 100,
  rationale text not null,
  mapping_version text not null,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists intelligence_decision_domain_map_active_unique_v1
  on local_intel.intelligence_decision_domain_map(decision_kind,prediction_kind)
  where status='active';

create table if not exists local_intel.intelligence_action_authority_policies (
  id uuid primary key default gen_random_uuid(),
  domain_key text not null references local_intel.intelligence_competence_domains(stable_key) on delete restrict,
  policy_version text not null,
  automation_allowed boolean not null default false,
  requires_versioned_model boolean not null default true,
  requires_probability boolean not null default true,
  requires_nonempty_evidence_snapshot boolean not null default true,
  min_model_scorable_outcomes integer not null check (min_model_scorable_outcomes >= 0),
  min_model_probability_scored_outcomes integer not null check (min_model_probability_scored_outcomes >= 0),
  min_bucket_probability_outcomes integer not null check (min_bucket_probability_outcomes >= 0),
  min_directional_accuracy numeric not null check (min_directional_accuracy between 0 and 1),
  max_mean_brier_score numeric not null check (max_mean_brier_score between 0 and 1),
  max_bucket_calibration_gap numeric not null check (max_bucket_calibration_gap between 0 and 1),
  min_probability_for_act numeric not null check (min_probability_for_act between 0 and 1),
  min_probability_for_human_review numeric not null check (min_probability_for_human_review between 0 and 1),
  policy_basis text not null,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_probability_for_human_review <= min_probability_for_act)
);

create unique index if not exists intelligence_action_authority_policy_active_unique_v1
  on local_intel.intelligence_action_authority_policies(domain_key)
  where status='active';

insert into local_intel.intelligence_competence_domains(stable_key,label,description)
values
  ('market_fit','Market fit','Whether an organization or target is likely to fit a specific offering/use case well enough to justify action.')
on conflict (stable_key) do update
set label=excluded.label,description=excluded.description,updated_at=now();

insert into local_intel.intelligence_decision_domain_map(
  decision_kind,prediction_kind,domain_key,priority,rationale,mapping_version,status
)
values (
  'campaign_target_selection','market_fit','market_fit',10,
  'Campaign target selection predicts market fit; competence must be learned in this domain rather than borrowed from identity or source-resolution accuracy.',
  '1.0','active'
)
on conflict (decision_kind,prediction_kind) where status='active' do update
set domain_key=excluded.domain_key,priority=excluded.priority,rationale=excluded.rationale,mapping_version=excluded.mapping_version,updated_at=now();

insert into local_intel.intelligence_action_authority_policies(
  domain_key,policy_version,automation_allowed,requires_versioned_model,requires_probability,requires_nonempty_evidence_snapshot,
  min_model_scorable_outcomes,min_model_probability_scored_outcomes,min_bucket_probability_outcomes,
  min_directional_accuracy,max_mean_brier_score,max_bucket_calibration_gap,
  min_probability_for_act,min_probability_for_human_review,policy_basis,status
)
values (
  'market_fit','1.0',true,true,true,true,
  30,20,8,
  0.75,0.18,0.10,
  0.85,0.60,
  'Conservative initial governance thresholds. These thresholds are policy, not empirical truth, and may only be revised by a later versioned policy after real outcome calibration exists.',
  'active'
)
on conflict (domain_key) where status='active' do update
set policy_version=excluded.policy_version,
    automation_allowed=excluded.automation_allowed,
    requires_versioned_model=excluded.requires_versioned_model,
    requires_probability=excluded.requires_probability,
    requires_nonempty_evidence_snapshot=excluded.requires_nonempty_evidence_snapshot,
    min_model_scorable_outcomes=excluded.min_model_scorable_outcomes,
    min_model_probability_scored_outcomes=excluded.min_model_probability_scored_outcomes,
    min_bucket_probability_outcomes=excluded.min_bucket_probability_outcomes,
    min_directional_accuracy=excluded.min_directional_accuracy,
    max_mean_brier_score=excluded.max_mean_brier_score,
    max_bucket_calibration_gap=excluded.max_bucket_calibration_gap,
    min_probability_for_act=excluded.min_probability_for_act,
    min_probability_for_human_review=excluded.min_probability_for_human_review,
    policy_basis=excluded.policy_basis,
    updated_at=now();

create or replace view local_intel.v_intelligence_probability_calibration_v1 as
select
  m.domain_key,
  d.model_key,
  d.model_version,
  d.decision_kind,
  d.prediction_kind,
  least(9,greatest(0,floor(e.predicted_probability*10)::integer)) as probability_decile,
  count(distinct e.outcome_id)::bigint as probability_scored_count,
  avg(e.predicted_probability)::numeric(8,5) as mean_predicted_probability,
  avg(e.observed_score)::numeric(8,5) as mean_observed_score,
  avg(e.squared_error)::numeric(8,5) as mean_brier_score,
  abs(avg(e.predicted_probability)-avg(e.observed_score))::numeric(8,5) as calibration_gap,
  min(e.evaluated_at) as first_evaluated_at,
  max(e.evaluated_at) as last_evaluated_at
from local_intel.intelligence_learning_evaluations e
join local_intel.intelligence_decisions d on d.id=e.decision_id
join local_intel.intelligence_decision_domain_map m
  on m.decision_kind=d.decision_kind
 and m.prediction_kind=d.prediction_kind
 and m.status='active'
where e.evaluation_state='probability_scored'
  and e.predicted_probability is not null
  and e.observed_score is not null
group by m.domain_key,d.model_key,d.model_version,d.decision_kind,d.prediction_kind,
         least(9,greatest(0,floor(e.predicted_probability*10)::integer));

create table if not exists local_intel.intelligence_authority_assessments (
  id uuid primary key default gen_random_uuid(),
  assessment_key text not null unique,
  decision_id uuid not null references local_intel.intelligence_decisions(id) on delete restrict,
  domain_key text,
  action_kind text not null,
  requested_actor_kind text not null,
  actor_execution_class text not null check (actor_execution_class in ('human','machine')),
  policy_version text,
  permission_state text not null check (permission_state in ('act','human_review','research_first','abstain')),
  permission_reason text not null,
  next_required_step text not null,
  machine_execution_allowed boolean not null,
  predicted_probability_snapshot numeric,
  model_key_snapshot text not null,
  model_version_snapshot text not null,
  model_scorable_outcome_count integer not null default 0,
  model_probability_scored_count integer not null default 0,
  model_directional_accuracy numeric,
  model_mean_brier_score numeric,
  probability_decile integer,
  bucket_probability_scored_count integer not null default 0,
  bucket_calibration_gap numeric,
  thresholds_snapshot jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists intelligence_authority_assessments_decision_idx
  on local_intel.intelligence_authority_assessments(decision_id,assessed_at desc);
create index if not exists intelligence_authority_assessments_state_idx
  on local_intel.intelligence_authority_assessments(permission_state,assessed_at desc);

create or replace function local_intel.block_intelligence_authority_assessment_mutation_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','local_intel'
as $function$
begin
  raise exception 'intelligence_authority_assessments is append-only';
end;
$function$;

drop trigger if exists intelligence_authority_assessments_append_only_v1 on local_intel.intelligence_authority_assessments;
create trigger intelligence_authority_assessments_append_only_v1
before update or delete on local_intel.intelligence_authority_assessments
for each row execute function local_intel.block_intelligence_authority_assessment_mutation_v1();

create or replace function local_intel.get_intelligence_decision_authority_v1(
  p_decision_id uuid,
  p_action_kind text default 'generic'
)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  d local_intel.intelligence_decisions%rowtype;
  p local_intel.intelligence_action_authority_policies%rowtype;
  v_domain text;
  v_model_scorable integer := 0;
  v_model_probability_scored integer := 0;
  v_directional_accuracy numeric;
  v_mean_brier numeric;
  v_learning_state text;
  v_decile integer;
  v_bucket_count integer := 0;
  v_bucket_gap numeric;
  v_state text;
  v_reason text;
  v_next text;
  v_thresholds jsonb := '{}'::jsonb;
begin
  select * into d from local_intel.intelligence_decisions where id=p_decision_id;
  if not found then
    raise exception 'Unknown intelligence decision %',p_decision_id;
  end if;

  select m.domain_key into v_domain
  from local_intel.intelligence_decision_domain_map m
  where m.decision_kind=d.decision_kind
    and m.prediction_kind=d.prediction_kind
    and m.status='active'
  order by m.priority,m.id
  limit 1;

  if v_domain is null then
    return jsonb_build_object(
      'decision_id',d.id,'domain_key',null,'action_kind',coalesce(nullif(btrim(p_action_kind),''),'generic'),
      'permission_state','abstain','permission_reason','unknown_competence_domain',
      'next_required_step','map_decision_to_governed_competence_domain',
      'machine_execution_allowed',false,
      'model_key',d.model_key,'model_version',d.model_version,'predicted_probability',d.predicted_probability,
      'policy_version',null,'calibration_state','unavailable'
    );
  end if;

  select * into p
  from local_intel.intelligence_action_authority_policies ap
  where ap.domain_key=v_domain and ap.status='active'
  order by ap.updated_at desc,ap.id
  limit 1;

  if not found then
    return jsonb_build_object(
      'decision_id',d.id,'domain_key',v_domain,'action_kind',coalesce(nullif(btrim(p_action_kind),''),'generic'),
      'permission_state','abstain','permission_reason','no_active_authority_policy',
      'next_required_step','author_governed_domain_policy',
      'machine_execution_allowed',false,
      'model_key',d.model_key,'model_version',d.model_version,'predicted_probability',d.predicted_probability,
      'policy_version',null,'calibration_state','unavailable'
    );
  end if;

  select
    coalesce(s.scorable_outcome_count,0)::integer,
    coalesce(s.probability_scored_count,0)::integer,
    s.directional_accuracy,
    s.mean_brier_score,
    s.learning_state
  into v_model_scorable,v_model_probability_scored,v_directional_accuracy,v_mean_brier,v_learning_state
  from local_intel.v_intelligence_learning_scorecard_v1 s
  where s.model_key=d.model_key
    and s.model_version=d.model_version
    and s.decision_kind=d.decision_kind
    and s.prediction_kind=d.prediction_kind;

  v_model_scorable := coalesce(v_model_scorable,0);
  v_model_probability_scored := coalesce(v_model_probability_scored,0);
  v_learning_state := coalesce(v_learning_state,'insufficient_sample');

  if d.predicted_probability is not null then
    v_decile := least(9,greatest(0,floor(d.predicted_probability*10)::integer));
    select c.probability_scored_count::integer,c.calibration_gap
      into v_bucket_count,v_bucket_gap
    from local_intel.v_intelligence_probability_calibration_v1 c
    where c.domain_key=v_domain
      and c.model_key=d.model_key
      and c.model_version=d.model_version
      and c.decision_kind=d.decision_kind
      and c.prediction_kind=d.prediction_kind
      and c.probability_decile=v_decile;
    v_bucket_count := coalesce(v_bucket_count,0);
  end if;

  v_thresholds := jsonb_build_object(
    'min_model_scorable_outcomes',p.min_model_scorable_outcomes,
    'min_model_probability_scored_outcomes',p.min_model_probability_scored_outcomes,
    'min_bucket_probability_outcomes',p.min_bucket_probability_outcomes,
    'min_directional_accuracy',p.min_directional_accuracy,
    'max_mean_brier_score',p.max_mean_brier_score,
    'max_bucket_calibration_gap',p.max_bucket_calibration_gap,
    'min_probability_for_act',p.min_probability_for_act,
    'min_probability_for_human_review',p.min_probability_for_human_review,
    'requires_versioned_model',p.requires_versioned_model,
    'requires_probability',p.requires_probability,
    'requires_nonempty_evidence_snapshot',p.requires_nonempty_evidence_snapshot,
    'automation_allowed',p.automation_allowed,
    'policy_basis',p.policy_basis
  );

  if not p.automation_allowed then
    v_state := 'human_review';
    v_reason := 'automation_disabled_for_domain';
    v_next := 'human_decision_required';
  elsif p.requires_versioned_model and (d.model_version is null or btrim(d.model_version)='' or lower(d.model_version)='unversioned') then
    v_state := 'research_first';
    v_reason := 'model_version_not_governed';
    v_next := 'issue_versioned_prediction_before_automation';
  elsif p.requires_probability and d.predicted_probability is null then
    v_state := 'research_first';
    v_reason := 'predicted_probability_missing';
    v_next := 'produce_probability_bearing_prediction';
  elsif p.requires_nonempty_evidence_snapshot and coalesce(d.evidence_snapshot,'{}'::jsonb)='{}'::jsonb then
    v_state := 'research_first';
    v_reason := 'decision_evidence_snapshot_empty';
    v_next := 'capture_decision_evidence_before_action';
  elsif v_model_scorable < p.min_model_scorable_outcomes then
    v_state := 'human_review';
    v_reason := 'insufficient_domain_model_outcomes';
    v_next := 'collect_real_outcomes_before_automation';
  elsif v_model_probability_scored < p.min_model_probability_scored_outcomes then
    v_state := 'human_review';
    v_reason := 'insufficient_probability_calibration_outcomes';
    v_next := 'collect_probability_scored_outcomes';
  elsif v_bucket_count < p.min_bucket_probability_outcomes then
    v_state := 'human_review';
    v_reason := 'probability_band_not_calibrated';
    v_next := 'collect_outcomes_in_probability_band';
  elsif v_directional_accuracy is null or v_mean_brier is null or v_bucket_gap is null then
    v_state := 'human_review';
    v_reason := 'calibration_metrics_incomplete';
    v_next := 'complete_model_calibration_metrics';
  elsif v_directional_accuracy < p.min_directional_accuracy then
    v_state := 'abstain';
    v_reason := 'directional_accuracy_below_policy';
    v_next := 'recalibrate_or_replace_model';
  elsif v_mean_brier > p.max_mean_brier_score then
    v_state := 'abstain';
    v_reason := 'probability_error_above_policy';
    v_next := 'recalibrate_or_replace_model';
  elsif v_bucket_gap > p.max_bucket_calibration_gap then
    v_state := 'abstain';
    v_reason := 'local_probability_band_miscalibrated';
    v_next := 'recalibrate_probability_band';
  elsif d.predicted_probability >= p.min_probability_for_act then
    v_state := 'act';
    v_reason := 'calibrated_domain_thresholds_satisfied';
    v_next := 'machine_execution_permitted';
  elsif d.predicted_probability >= p.min_probability_for_human_review then
    v_state := 'human_review';
    v_reason := 'calibrated_but_below_automation_probability';
    v_next := 'human_decision_required';
  else
    v_state := 'abstain';
    v_reason := 'predicted_probability_below_review_threshold';
    v_next := 'do_not_automate_without_new_evidence';
  end if;

  return jsonb_build_object(
    'decision_id',d.id,
    'domain_key',v_domain,
    'action_kind',coalesce(nullif(btrim(p_action_kind),''),'generic'),
    'permission_state',v_state,
    'permission_reason',v_reason,
    'next_required_step',v_next,
    'machine_execution_allowed',(v_state='act'),
    'policy_version',p.policy_version,
    'model_key',d.model_key,
    'model_version',d.model_version,
    'predicted_probability',d.predicted_probability,
    'model_scorable_outcome_count',v_model_scorable,
    'model_probability_scored_count',v_model_probability_scored,
    'model_directional_accuracy',v_directional_accuracy,
    'model_mean_brier_score',v_mean_brier,
    'learning_state',v_learning_state,
    'probability_decile',v_decile,
    'bucket_probability_scored_count',v_bucket_count,
    'bucket_calibration_gap',v_bucket_gap,
    'thresholds',v_thresholds,
    'source_reliability_integration_state','separate_signal_not_silently_substituted_for_outcome_calibration'
  );
end;
$function$;

create or replace function local_intel.record_intelligence_authority_assessment_v1(
  p_assessment_key text,
  p_decision_id uuid,
  p_action_kind text,
  p_actor_kind text
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  v_id uuid;
  v_gate jsonb;
  v_actor_class text;
  d local_intel.intelligence_decisions%rowtype;
begin
  if p_assessment_key is null or btrim(p_assessment_key)='' then raise exception 'assessment_key is required'; end if;
  if p_action_kind is null or btrim(p_action_kind)='' then raise exception 'action_kind is required'; end if;
  if p_actor_kind is null or btrim(p_actor_kind)='' then raise exception 'actor_kind is required'; end if;

  select * into d from local_intel.intelligence_decisions where id=p_decision_id;
  if not found then raise exception 'Unknown intelligence decision %',p_decision_id; end if;

  v_actor_class := case
    when lower(btrim(p_actor_kind)) in ('human','operator','owner','principal','staff','worker') then 'human'
    else 'machine'
  end;

  v_gate := local_intel.get_intelligence_decision_authority_v1(p_decision_id,p_action_kind);

  insert into local_intel.intelligence_authority_assessments(
    assessment_key,decision_id,domain_key,action_kind,requested_actor_kind,actor_execution_class,
    policy_version,permission_state,permission_reason,next_required_step,machine_execution_allowed,
    predicted_probability_snapshot,model_key_snapshot,model_version_snapshot,
    model_scorable_outcome_count,model_probability_scored_count,model_directional_accuracy,model_mean_brier_score,
    probability_decile,bucket_probability_scored_count,bucket_calibration_gap,thresholds_snapshot,evidence_snapshot
  ) values (
    p_assessment_key,p_decision_id,v_gate->>'domain_key',p_action_kind,p_actor_kind,v_actor_class,
    v_gate->>'policy_version',v_gate->>'permission_state',v_gate->>'permission_reason',v_gate->>'next_required_step',
    coalesce((v_gate->>'machine_execution_allowed')::boolean,false),
    d.predicted_probability,d.model_key,d.model_version,
    coalesce((v_gate->>'model_scorable_outcome_count')::integer,0),
    coalesce((v_gate->>'model_probability_scored_count')::integer,0),
    nullif(v_gate->>'model_directional_accuracy','')::numeric,
    nullif(v_gate->>'model_mean_brier_score','')::numeric,
    nullif(v_gate->>'probability_decile','')::integer,
    coalesce((v_gate->>'bucket_probability_scored_count')::integer,0),
    nullif(v_gate->>'bucket_calibration_gap','')::numeric,
    coalesce(v_gate->'thresholds','{}'::jsonb),
    d.evidence_snapshot
  )
  on conflict (assessment_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from local_intel.intelligence_authority_assessments where assessment_key=p_assessment_key;
  end if;
  return v_id;
end;
$function$;

alter table local_intel.intelligence_actions
  add column if not exists authority_assessment_id uuid references local_intel.intelligence_authority_assessments(id) on delete restrict;

alter table local_intel.intelligence_actions
  alter column authority_assessment_id set not null;

create index if not exists intelligence_actions_authority_assessment_idx
  on local_intel.intelligence_actions(authority_assessment_id);

create or replace function local_intel.record_intelligence_action_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  v_id uuid;
  v_key text := nullif(btrim(p_payload->>'action_key'),'');
  v_decision uuid;
  v_action_kind text := nullif(btrim(p_payload->>'action_kind'),'');
  v_action_state text := nullif(btrim(p_payload->>'action_state'),'');
  v_actor_kind text := nullif(btrim(p_payload->>'actor_kind'),'');
  v_actor_class text;
  v_gate jsonb;
  v_assessment_id uuid;
begin
  if v_key is null then raise exception 'action_key is required'; end if;

  select id into v_id from local_intel.intelligence_actions where action_key=v_key;
  if v_id is not null then return v_id; end if;

  begin v_decision := (p_payload->>'decision_id')::uuid; exception when invalid_text_representation or null_value_not_allowed then raise exception 'decision_id must be UUID'; end;
  if not exists(select 1 from local_intel.intelligence_decisions where id=v_decision) then raise exception 'Unknown decision %',v_decision; end if;
  if v_action_kind is null then raise exception 'action_kind is required'; end if;
  if v_action_state not in ('planned','executed','failed','cancelled') then raise exception 'Invalid action_state'; end if;
  if v_actor_kind is null then raise exception 'actor_kind is required'; end if;

  v_actor_class := case
    when lower(v_actor_kind) in ('human','operator','owner','principal','staff','worker') then 'human'
    else 'machine'
  end;

  v_gate := local_intel.get_intelligence_decision_authority_v1(v_decision,v_action_kind);

  if v_action_state='executed' and v_actor_class='machine' and coalesce((v_gate->>'machine_execution_allowed')::boolean,false)=false then
    raise exception 'Machine execution not authorized: % (%)',v_gate->>'permission_state',v_gate->>'permission_reason';
  end if;

  v_assessment_id := local_intel.record_intelligence_authority_assessment_v1(
    'action:'||v_key,v_decision,v_action_kind,v_actor_kind
  );

  insert into local_intel.intelligence_actions(
    action_key,decision_id,action_kind,action_state,actor_kind,actor_ref,channel,action_snapshot,occurred_at,metadata,authority_assessment_id
  ) values (
    v_key,v_decision,v_action_kind,v_action_state,v_actor_kind,nullif(p_payload->>'actor_ref',''),nullif(p_payload->>'channel',''),
    coalesce(p_payload->'action_snapshot','{}'::jsonb) || jsonb_build_object('system_authority',v_gate,'actor_execution_class',v_actor_class),
    coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,now()),
    coalesce(p_payload->'metadata','{}'::jsonb) || jsonb_build_object('authority_assessment_id',v_assessment_id),
    v_assessment_id
  )
  on conflict (action_key) do nothing returning id into v_id;

  if v_id is null then select id into v_id from local_intel.intelligence_actions where action_key=v_key; end if;
  return v_id;
end;
$function$;

create or replace view local_intel.v_intelligence_decision_authority_v1 as
select
  d.id as decision_id,
  d.stable_key,
  d.decision_kind,
  d.prediction_kind,
  d.model_key,
  d.model_version,
  d.predicted_class,
  d.predicted_probability,
  g.gate->>'domain_key' as domain_key,
  g.gate->>'permission_state' as permission_state,
  g.gate->>'permission_reason' as permission_reason,
  g.gate->>'next_required_step' as next_required_step,
  coalesce((g.gate->>'machine_execution_allowed')::boolean,false) as machine_execution_allowed,
  g.gate as authority_packet
from local_intel.intelligence_decisions d
cross join lateral (
  select local_intel.get_intelligence_decision_authority_v1(d.id,'generic') as gate
) g;

create or replace view local_intel.v_intelligence_abstention_queue_v1 as
select
  a.decision_id,a.stable_key,a.decision_kind,a.prediction_kind,a.model_key,a.model_version,
  a.predicted_class,a.predicted_probability,a.domain_key,a.permission_state,a.permission_reason,a.next_required_step,
  a.authority_packet
from local_intel.v_intelligence_decision_authority_v1 a
where a.permission_state <> 'act';

revoke all on local_intel.intelligence_competence_domains from public, anon, authenticated;
revoke all on local_intel.intelligence_decision_domain_map from public, anon, authenticated;
revoke all on local_intel.intelligence_action_authority_policies from public, anon, authenticated;
revoke all on local_intel.intelligence_authority_assessments from public, anon, authenticated;
revoke all on local_intel.v_intelligence_probability_calibration_v1 from public, anon, authenticated;
revoke all on local_intel.v_intelligence_decision_authority_v1 from public, anon, authenticated;
revoke all on local_intel.v_intelligence_abstention_queue_v1 from public, anon, authenticated;

revoke execute on function local_intel.block_intelligence_authority_assessment_mutation_v1() from public, anon, authenticated, service_role;
revoke execute on function local_intel.get_intelligence_decision_authority_v1(uuid,text) from public, anon, authenticated;
revoke execute on function local_intel.record_intelligence_authority_assessment_v1(text,uuid,text,text) from public, anon, authenticated;
revoke execute on function local_intel.record_intelligence_action_v1(jsonb) from public, anon, authenticated;

revoke insert,update,delete on local_intel.intelligence_actions from service_role;
revoke insert,update,delete on local_intel.intelligence_authority_assessments from service_role;

grant select on local_intel.intelligence_competence_domains to service_role;
grant select on local_intel.intelligence_decision_domain_map to service_role;
grant select on local_intel.intelligence_action_authority_policies to service_role;
grant select on local_intel.intelligence_authority_assessments to service_role;
grant select on local_intel.v_intelligence_probability_calibration_v1 to service_role;
grant select on local_intel.v_intelligence_decision_authority_v1 to service_role;
grant select on local_intel.v_intelligence_abstention_queue_v1 to service_role;
grant select on local_intel.intelligence_actions to service_role;

grant execute on function local_intel.get_intelligence_decision_authority_v1(uuid,text) to service_role;
grant execute on function local_intel.record_intelligence_authority_assessment_v1(text,uuid,text,text) to service_role;
grant execute on function local_intel.record_intelligence_action_v1(jsonb) to service_role;
