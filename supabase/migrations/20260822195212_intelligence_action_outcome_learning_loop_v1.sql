create table if not exists local_intel.intelligence_decisions (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null unique,
  decision_kind text not null,
  subject_entity_id uuid references local_intel.entities(id) on delete set null,
  campaign_target_id uuid references local_intel.campaign_targets(id) on delete set null,
  offering_use_case_id uuid references local_intel.offering_use_cases(id) on delete set null,
  source_object_kind text not null,
  source_object_ref text not null,
  model_key text not null,
  model_version text not null,
  prediction_kind text not null,
  predicted_class text,
  predicted_probability numeric check (predicted_probability is null or (predicted_probability >= 0 and predicted_probability <= 1)),
  rank_score numeric,
  recommendation text not null,
  feature_snapshot jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists intelligence_decisions_model_idx on local_intel.intelligence_decisions(model_key,model_version,prediction_kind,issued_at desc);
create index if not exists intelligence_decisions_subject_idx on local_intel.intelligence_decisions(subject_entity_id,issued_at desc);
create index if not exists intelligence_decisions_campaign_target_idx on local_intel.intelligence_decisions(campaign_target_id,issued_at desc) where campaign_target_id is not null;

create table if not exists local_intel.intelligence_actions (
  id uuid primary key default gen_random_uuid(),
  action_key text not null unique,
  decision_id uuid not null references local_intel.intelligence_decisions(id) on delete restrict,
  action_kind text not null,
  action_state text not null check (action_state in ('planned','executed','failed','cancelled')),
  actor_kind text not null,
  actor_ref text,
  channel text,
  action_snapshot jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists intelligence_actions_decision_idx on local_intel.intelligence_actions(decision_id,occurred_at desc);

create table if not exists local_intel.intelligence_outcome_scoring_policies (
  policy_key text primary key,
  decision_kind text not null,
  prediction_kind text not null,
  outcome_kind text not null,
  outcome_score numeric check (outcome_score is null or (outcome_score >= 0 and outcome_score <= 1)),
  interpretation_state text not null check (interpretation_state in ('directly_scorable','context_required','operational_only')),
  rationale text not null,
  policy_version text not null,
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(decision_kind,prediction_kind,outcome_kind,policy_version)
);
insert into local_intel.intelligence_outcome_scoring_policies(policy_key,decision_kind,prediction_kind,outcome_kind,outcome_score,interpretation_state,rationale,policy_version)
values
('campaign_market_fit_booked_v1','campaign_target_selection','market_fit','booked',1.00,'directly_scorable','A completed booking is direct positive evidence for the targeted organization × use-case market-fit hypothesis.','1.0'),
('campaign_market_fit_wants_tour_v1','campaign_target_selection','market_fit','wants_tour',0.90,'directly_scorable','A requested tour is strong positive intent evidence, short of a completed booking.','1.0'),
('campaign_market_fit_interested_v1','campaign_target_selection','market_fit','interested',0.80,'directly_scorable','Expressed interest is positive fit evidence but remains weaker than tour or booking behavior.','1.0'),
('campaign_market_fit_uses_own_facility_v1','campaign_target_selection','market_fit','uses_own_facility',0.10,'directly_scorable','For the scoped external-space use case, self-supply is strong negative evidence for immediate external-space fit without asserting global lack of demand.','1.0'),
('campaign_market_fit_no_current_need_v1','campaign_target_selection','market_fit','no_current_need',null,'context_required','The existing campaign rule correctly says this may mean wrong timing, wrong use case, or no recurring demand. Do not score until interpreted.','1.0'),
('campaign_market_fit_wrong_person_v1','campaign_target_selection','market_fit','wrong_person',null,'context_required','Wrong-person feedback evaluates buyer resolution, not necessarily organization-level market fit.','1.0'),
('campaign_market_fit_needs_pricing_v1','campaign_target_selection','market_fit','needs_pricing',null,'context_required','A pricing request can indicate interest but primarily exposes an offer-information gap; preserve without forcing a market-fit score.','1.0'),
('campaign_market_fit_replied_v1','campaign_target_selection','market_fit','replied',null,'context_required','A reply must be classified into a substantive outcome before scoring fit.','1.0'),
('campaign_market_fit_delivered_v1','campaign_target_selection','market_fit','delivered',null,'operational_only','Delivery is channel evidence, not market-fit evidence.','1.0'),
('campaign_market_fit_opened_v1','campaign_target_selection','market_fit','opened',null,'operational_only','Open behavior is weak engagement and must not be treated as fit.','1.0'),
('campaign_market_fit_bounce_v1','campaign_target_selection','market_fit','bounce',null,'operational_only','Bounce evaluates contact-route validity, not organization market fit.','1.0'),
('campaign_market_fit_unsubscribe_v1','campaign_target_selection','market_fit','unsubscribe',null,'operational_only','Unsubscribe is a marketing-suppression signal and is not a clean fit evaluation.','1.0')
on conflict (policy_key) do update set outcome_score=excluded.outcome_score,interpretation_state=excluded.interpretation_state,rationale=excluded.rationale,policy_version=excluded.policy_version,status='active',updated_at=now();

create table if not exists local_intel.intelligence_outcomes (
  id uuid primary key default gen_random_uuid(),
  outcome_key text not null unique,
  decision_id uuid not null references local_intel.intelligence_decisions(id) on delete restrict,
  action_id uuid references local_intel.intelligence_actions(id) on delete restrict,
  outcome_kind text not null,
  outcome_class text,
  outcome_score numeric check (outcome_score is null or (outcome_score >= 0 and outcome_score <= 1)),
  interpretation_state text not null check (interpretation_state in ('directly_scorable','context_required','operational_only','unmapped')),
  scoring_policy_key text references local_intel.intelligence_outcome_scoring_policies(policy_key) on delete restrict,
  evidence_source_kind text not null,
  evidence_ref text,
  occurred_at timestamptz not null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists intelligence_outcomes_decision_idx on local_intel.intelligence_outcomes(decision_id,occurred_at desc);

create table if not exists local_intel.intelligence_learning_evaluations (
  id uuid primary key default gen_random_uuid(),
  evaluation_key text not null unique,
  decision_id uuid not null references local_intel.intelligence_decisions(id) on delete restrict,
  outcome_id uuid not null references local_intel.intelligence_outcomes(id) on delete restrict,
  evaluation_version text not null,
  predicted_probability numeric check (predicted_probability is null or (predicted_probability >= 0 and predicted_probability <= 1)),
  observed_score numeric check (observed_score is null or (observed_score >= 0 and observed_score <= 1)),
  squared_error numeric,
  predicted_direction text check (predicted_direction is null or predicted_direction in ('positive','negative','unscored')),
  observed_direction text check (observed_direction is null or observed_direction in ('positive','negative','unscored')),
  direction_correct boolean,
  evaluation_state text not null check (evaluation_state in ('probability_scored','direction_scored','outcome_not_scorable','prediction_not_scorable')),
  metadata jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(decision_id,outcome_id,evaluation_version)
);
create index if not exists intelligence_learning_eval_model_idx on local_intel.intelligence_learning_evaluations(evaluated_at desc,decision_id);

create or replace function local_intel.block_intelligence_learning_history_mutation_v1()
returns trigger language plpgsql set search_path to 'pg_catalog','local_intel' as $function$
begin raise exception '% is append-only', tg_table_name; end;
$function$;

drop trigger if exists intelligence_decisions_append_only_v1 on local_intel.intelligence_decisions;
create trigger intelligence_decisions_append_only_v1 before update or delete on local_intel.intelligence_decisions for each row execute function local_intel.block_intelligence_learning_history_mutation_v1();
drop trigger if exists intelligence_actions_append_only_v1 on local_intel.intelligence_actions;
create trigger intelligence_actions_append_only_v1 before update or delete on local_intel.intelligence_actions for each row execute function local_intel.block_intelligence_learning_history_mutation_v1();
drop trigger if exists intelligence_outcomes_append_only_v1 on local_intel.intelligence_outcomes;
create trigger intelligence_outcomes_append_only_v1 before update or delete on local_intel.intelligence_outcomes for each row execute function local_intel.block_intelligence_learning_history_mutation_v1();
drop trigger if exists intelligence_learning_evaluations_append_only_v1 on local_intel.intelligence_learning_evaluations;
create trigger intelligence_learning_evaluations_append_only_v1 before update or delete on local_intel.intelligence_learning_evaluations for each row execute function local_intel.block_intelligence_learning_history_mutation_v1();

create or replace function local_intel.capture_campaign_target_decision_v1(p_campaign_target_id uuid)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$
declare t local_intel.campaign_targets%rowtype; v_id uuid; v_stable_key text;
begin
  select * into t from local_intel.campaign_targets where id=p_campaign_target_id;
  if not found then raise exception 'Unknown campaign target %', p_campaign_target_id; end if;
  v_stable_key := 'campaign_target:' || t.id::text || ':market_fit:v1';
  insert into local_intel.intelligence_decisions(stable_key,decision_kind,subject_entity_id,campaign_target_id,offering_use_case_id,source_object_kind,source_object_ref,model_key,model_version,prediction_kind,predicted_class,predicted_probability,rank_score,recommendation,feature_snapshot,evidence_snapshot,issued_at,metadata)
  values(v_stable_key,'campaign_target_selection',t.organization_entity_id,t.id,t.offering_use_case_id,'campaign_target',t.id::text,coalesce(nullif(t.metadata->>'ranking_model_key',''),'campaign_target_rank_score'),coalesce(nullif(t.metadata->>'ranking_model_version',''),'unversioned'),'market_fit',t.qualification_tier,case when jsonb_typeof(t.metadata->'predicted_probability')='number' then (t.metadata->>'predicted_probability')::numeric else null end,t.rank_score,'Include this organization × use-case pair in the campaign target set at the recorded qualification tier.',jsonb_build_object('qualification_tier',t.qualification_tier,'target_state',t.target_state,'rank_score',t.rank_score,'test_wave',t.test_wave,'test_cell',t.test_cell,'venue_fit_readiness',t.venue_fit_readiness,'organizer_resolution_state',t.organizer_resolution_state,'marketing_clearance_state',t.marketing_clearance_state,'buyer_context_snapshot',coalesce(t.buyer_context_snapshot,'{}'::jsonb),'qualification_snapshot',coalesce(t.qualification_snapshot,'{}'::jsonb)),jsonb_build_object('campaign_id',t.campaign_id,'segment_id',t.segment_id),coalesce(t.selected_at,t.created_at,now()),jsonb_build_object('snapshot_origin','campaign_target','historical_probability_available',jsonb_typeof(t.metadata->'predicted_probability')='number'))
  on conflict (stable_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from local_intel.intelligence_decisions where stable_key=v_stable_key; end if;
  return v_id;
end;
$function$;

create or replace function local_intel.capture_new_campaign_target_decision_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$
begin perform local_intel.capture_campaign_target_decision_v1(new.id); return new; end;
$function$;
drop trigger if exists campaign_target_decision_snapshot_v1 on local_intel.campaign_targets;
create trigger campaign_target_decision_snapshot_v1 after insert on local_intel.campaign_targets for each row execute function local_intel.capture_new_campaign_target_decision_v1();

create or replace function local_intel.evaluate_intelligence_outcome_v1(p_outcome_id uuid)
returns uuid language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$
declare o local_intel.intelligence_outcomes%rowtype; d local_intel.intelligence_decisions%rowtype; v_pred_dir text; v_obs_dir text; v_state text; v_error numeric; v_correct boolean; v_eval_key text; v_id uuid;
begin
  select * into o from local_intel.intelligence_outcomes where id=p_outcome_id;
  if not found then raise exception 'Unknown outcome %',p_outcome_id; end if;
  select * into d from local_intel.intelligence_decisions where id=o.decision_id;
  v_eval_key := 'outcome:' || o.id::text || ':evaluation:v1';
  if o.outcome_score is null then
    v_obs_dir := 'unscored';
    v_pred_dir := case when d.predicted_probability is not null then case when d.predicted_probability >= 0.5 then 'positive' else 'negative' end when d.predicted_class in ('contact_candidate','qualify','positive','yes','recommended') then 'positive' when d.predicted_class in ('hold','deprioritize','negative','no','not_recommended') then 'negative' else 'unscored' end;
    v_state := 'outcome_not_scorable';
  else
    v_obs_dir := case when o.outcome_score >= 0.5 then 'positive' else 'negative' end;
    if d.predicted_probability is not null then
      v_pred_dir := case when d.predicted_probability >= 0.5 then 'positive' else 'negative' end; v_error := power(d.predicted_probability-o.outcome_score,2); v_correct := (v_pred_dir=v_obs_dir); v_state := 'probability_scored';
    elsif d.predicted_class in ('contact_candidate','qualify','positive','yes','recommended','hold','deprioritize','negative','no','not_recommended') then
      v_pred_dir := case when d.predicted_class in ('contact_candidate','qualify','positive','yes','recommended') then 'positive' else 'negative' end; v_correct := (v_pred_dir=v_obs_dir); v_state := 'direction_scored';
    else v_pred_dir := 'unscored'; v_state := 'prediction_not_scorable'; end if;
  end if;
  insert into local_intel.intelligence_learning_evaluations(evaluation_key,decision_id,outcome_id,evaluation_version,predicted_probability,observed_score,squared_error,predicted_direction,observed_direction,direction_correct,evaluation_state,metadata)
  values(v_eval_key,d.id,o.id,'1.0',d.predicted_probability,o.outcome_score,v_error,v_pred_dir,v_obs_dir,v_correct,v_state,jsonb_build_object('model_key',d.model_key,'model_version',d.model_version,'decision_kind',d.decision_kind,'prediction_kind',d.prediction_kind))
  on conflict (evaluation_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from local_intel.intelligence_learning_evaluations where evaluation_key=v_eval_key; end if;
  return v_id;
end;
$function$;

create or replace function local_intel.capture_campaign_response_outcome_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','local_intel' as $function$
declare v_decision_id uuid; v_policy local_intel.intelligence_outcome_scoring_policies%rowtype; v_outcome_id uuid; v_key text; v_policy_found boolean;
begin
  v_decision_id := local_intel.capture_campaign_target_decision_v1(new.campaign_target_id);
  select * into v_policy from local_intel.intelligence_outcome_scoring_policies p where p.status='active' and p.decision_kind='campaign_target_selection' and p.prediction_kind='market_fit' and p.outcome_kind=new.event_type order by p.updated_at desc limit 1;
  v_policy_found := found;
  v_key := 'campaign_response:' || new.id::text || ':market_fit_outcome:v1';
  insert into local_intel.intelligence_outcomes(outcome_key,decision_id,action_id,outcome_kind,outcome_class,outcome_score,interpretation_state,scoring_policy_key,evidence_source_kind,evidence_ref,occurred_at,evidence_snapshot,metadata)
  values(v_key,v_decision_id,null,new.event_type,new.event_type,case when v_policy_found then v_policy.outcome_score else null end,case when v_policy_found then v_policy.interpretation_state else 'unmapped' end,case when v_policy_found then v_policy.policy_key else null end,'campaign_response_event',new.id::text,new.occurred_at,jsonb_build_object('campaign_id',new.campaign_id,'campaign_target_id',new.campaign_target_id,'campaign_contact_id',new.campaign_contact_id,'source',new.source,'notes',new.notes,'event_data',coalesce(new.event_data,'{}'::jsonb)),jsonb_build_object('bridge_version','1.0'))
  on conflict (outcome_key) do nothing returning id into v_outcome_id;
  if v_outcome_id is null then select id into v_outcome_id from local_intel.intelligence_outcomes where outcome_key=v_key; end if;
  perform local_intel.evaluate_intelligence_outcome_v1(v_outcome_id);
  return new;
end;
$function$;
drop trigger if exists campaign_response_learning_bridge_v1 on local_intel.campaign_response_events;
create trigger campaign_response_learning_bridge_v1 after insert on local_intel.campaign_response_events for each row execute function local_intel.capture_campaign_response_outcome_v1();

create or replace view local_intel.v_intelligence_decision_feedback_v1 as
select d.id as decision_id,d.stable_key,d.decision_kind,d.subject_entity_id,d.campaign_target_id,d.offering_use_case_id,d.model_key,d.model_version,d.prediction_kind,d.predicted_class,d.predicted_probability,d.rank_score,d.issued_at,count(distinct a.id)::bigint as action_count,count(distinct o.id)::bigint as outcome_count,count(distinct e.id)::bigint as evaluation_count,max(a.occurred_at) as latest_action_at,max(o.occurred_at) as latest_outcome_at,(array_agg(o.outcome_kind order by o.occurred_at desc) filter (where o.id is not null))[1] as latest_outcome_kind,(array_agg(o.outcome_score order by o.occurred_at desc) filter (where o.id is not null))[1] as latest_outcome_score,(array_agg(e.evaluation_state order by e.evaluated_at desc) filter (where e.id is not null))[1] as latest_evaluation_state,case when count(o.id)=0 then 'awaiting_outcome' when count(e.id)=0 then 'outcome_not_evaluated' when bool_or(e.evaluation_state in ('probability_scored','direction_scored')) then 'learning_observed' else 'outcome_preserved_not_scorable' end as learning_state
from local_intel.intelligence_decisions d left join local_intel.intelligence_actions a on a.decision_id=d.id left join local_intel.intelligence_outcomes o on o.decision_id=d.id left join local_intel.intelligence_learning_evaluations e on e.decision_id=d.id and e.outcome_id=o.id group by d.id;

create or replace view local_intel.v_intelligence_learning_scorecard_v1 as
select d.model_key,d.model_version,d.decision_kind,d.prediction_kind,count(distinct d.id)::bigint as decision_count,count(distinct e.outcome_id)::bigint as evaluated_outcome_count,count(distinct e.outcome_id) filter (where e.evaluation_state in ('probability_scored','direction_scored'))::bigint as scorable_outcome_count,count(distinct e.outcome_id) filter (where e.evaluation_state='probability_scored')::bigint as probability_scored_count,avg(e.predicted_probability) filter (where e.evaluation_state='probability_scored')::numeric(8,5) as mean_predicted_probability,avg(e.observed_score) filter (where e.evaluation_state in ('probability_scored','direction_scored'))::numeric(8,5) as mean_observed_score,avg(e.squared_error) filter (where e.evaluation_state='probability_scored')::numeric(8,5) as mean_brier_score,avg(case when e.direction_correct then 1::numeric when e.direction_correct=false then 0::numeric else null end)::numeric(8,5) as directional_accuracy,case when count(distinct e.outcome_id) filter (where e.evaluation_state in ('probability_scored','direction_scored')) < 10 then 'insufficient_sample' when count(distinct e.outcome_id) filter (where e.evaluation_state in ('probability_scored','direction_scored')) < 30 then 'emerging' else 'established' end as learning_state
from local_intel.intelligence_decisions d left join local_intel.intelligence_learning_evaluations e on e.decision_id=d.id group by d.model_key,d.model_version,d.decision_kind,d.prediction_kind;

create or replace view local_intel.v_campaign_target_learning_v2 as
select t.id as campaign_target_id,t.campaign_id,t.organization_entity_id,t.offering_use_case_id,t.qualification_tier,t.rank_score,t.test_wave,t.test_cell,d.id as decision_id,d.model_key,d.model_version,d.predicted_probability,f.action_count,f.outcome_count,f.evaluation_count,f.latest_outcome_kind,f.latest_outcome_score,f.latest_evaluation_state,f.learning_state
from local_intel.campaign_targets t left join local_intel.intelligence_decisions d on d.campaign_target_id=t.id and d.decision_kind='campaign_target_selection' and d.prediction_kind='market_fit' left join local_intel.v_intelligence_decision_feedback_v1 f on f.decision_id=d.id;

do $block$ declare r record; begin for r in select id from local_intel.campaign_targets loop perform local_intel.capture_campaign_target_decision_v1(r.id); end loop; end; $block$;

revoke all on local_intel.intelligence_decisions, local_intel.intelligence_actions, local_intel.intelligence_outcomes, local_intel.intelligence_learning_evaluations, local_intel.intelligence_outcome_scoring_policies from public, anon, authenticated;
revoke all on local_intel.v_intelligence_decision_feedback_v1, local_intel.v_intelligence_learning_scorecard_v1, local_intel.v_campaign_target_learning_v2 from public, anon, authenticated;
revoke execute on function local_intel.block_intelligence_learning_history_mutation_v1() from public, anon, authenticated;
revoke execute on function local_intel.capture_campaign_target_decision_v1(uuid) from public, anon, authenticated;
revoke execute on function local_intel.capture_new_campaign_target_decision_v1() from public, anon, authenticated;
revoke execute on function local_intel.evaluate_intelligence_outcome_v1(uuid) from public, anon, authenticated;
revoke execute on function local_intel.capture_campaign_response_outcome_v1() from public, anon, authenticated;
grant select,insert on local_intel.intelligence_decisions, local_intel.intelligence_actions, local_intel.intelligence_outcomes, local_intel.intelligence_learning_evaluations to service_role;
grant select,insert,update,delete on local_intel.intelligence_outcome_scoring_policies to service_role;
grant select on local_intel.v_intelligence_decision_feedback_v1, local_intel.v_intelligence_learning_scorecard_v1, local_intel.v_campaign_target_learning_v2 to service_role;
grant execute on function local_intel.capture_campaign_target_decision_v1(uuid) to service_role;
grant execute on function local_intel.evaluate_intelligence_outcome_v1(uuid) to service_role;