alter table local_intel.campaign_response_events
  add column if not exists preceding_action_id uuid references local_intel.intelligence_actions(id) on delete restrict;

create index if not exists campaign_response_events_preceding_action_idx
  on local_intel.campaign_response_events(preceding_action_id)
  where preceding_action_id is not null;

create or replace function local_intel.block_campaign_response_event_mutation_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','local_intel'
as $function$
begin
  raise exception 'campaign response events are append-only evidence; insert a new event instead of rewriting history';
end;
$function$;

drop trigger if exists campaign_response_events_append_only_v1 on local_intel.campaign_response_events;
create trigger campaign_response_events_append_only_v1
before update or delete on local_intel.campaign_response_events
for each row execute function local_intel.block_campaign_response_event_mutation_v1();

create or replace function local_intel.validate_campaign_response_event_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  t local_intel.campaign_targets%rowtype;
  c local_intel.campaign_contacts%rowtype;
  a local_intel.intelligence_actions%rowtype;
  d local_intel.intelligence_decisions%rowtype;
  p local_intel.intelligence_outcome_scoring_policies%rowtype;
  v_decision_id uuid;
  v_policy_found boolean := false;
begin
  select * into t
  from local_intel.campaign_targets
  where id=new.campaign_target_id;
  if not found then
    raise exception 'Unknown campaign target %',new.campaign_target_id;
  end if;

  if new.campaign_id is distinct from t.campaign_id then
    raise exception 'Response campaign % does not match target campaign %',new.campaign_id,t.campaign_id;
  end if;

  if new.campaign_contact_id is not null then
    select * into c
    from local_intel.campaign_contacts
    where id=new.campaign_contact_id;
    if not found then
      raise exception 'Unknown campaign contact %',new.campaign_contact_id;
    end if;
    if c.campaign_id is distinct from t.campaign_id
       or c.campaign_target_id is distinct from t.id
       or c.entity_id is distinct from t.organization_entity_id then
      raise exception 'Campaign contact % does not belong to target %',c.id,t.id;
    end if;
  end if;

  v_decision_id := local_intel.capture_campaign_target_decision_v1(t.id);
  select * into d from local_intel.intelligence_decisions where id=v_decision_id;

  if new.preceding_action_id is not null then
    select * into a
    from local_intel.intelligence_actions
    where id=new.preceding_action_id;
    if not found then
      raise exception 'Unknown preceding intelligence action %',new.preceding_action_id;
    end if;
    if a.decision_id is distinct from v_decision_id then
      raise exception 'Preceding action % belongs to a different intelligence decision',a.id;
    end if;
    if a.action_state <> 'executed' then
      raise exception 'Preceding action % is not executed',a.id;
    end if;
    if a.action_kind <> 'campaign_outreach' then
      raise exception 'Preceding action % is not campaign outreach',a.id;
    end if;
    if a.occurred_at > new.occurred_at then
      raise exception 'Preceding action % occurs after the response event',a.id;
    end if;
    if nullif(a.action_snapshot->>'campaign_target_id','') is distinct from t.id::text then
      raise exception 'Preceding action % does not name target % in its execution snapshot',a.id,t.id;
    end if;
  end if;

  select * into p
  from local_intel.intelligence_outcome_scoring_policies
  where status='active'
    and decision_kind=d.decision_kind
    and prediction_kind=d.prediction_kind
    and outcome_kind=new.event_type
  order by updated_at desc
  limit 1;
  v_policy_found := found;

  if v_policy_found
     and p.outcome_score is not null
     and d.predicted_probability is not null
     and new.preceding_action_id is null then
    raise exception 'Probability-scored market-fit response % requires the exact preceding campaign outreach action',new.event_type;
  end if;

  return new;
end;
$function$;

drop trigger if exists campaign_response_event_integrity_v1 on local_intel.campaign_response_events;
create trigger campaign_response_event_integrity_v1
before insert on local_intel.campaign_response_events
for each row execute function local_intel.validate_campaign_response_event_v1();

create or replace function local_intel.capture_campaign_response_outcome_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  v_decision_id uuid;
  v_policy local_intel.intelligence_outcome_scoring_policies%rowtype;
  v_outcome_id uuid;
  v_key text;
  v_policy_found boolean;
begin
  v_decision_id := local_intel.capture_campaign_target_decision_v1(new.campaign_target_id);
  select * into v_policy
  from local_intel.intelligence_outcome_scoring_policies p
  where p.status='active'
    and p.decision_kind='campaign_target_selection'
    and p.prediction_kind='market_fit'
    and p.outcome_kind=new.event_type
  order by p.updated_at desc
  limit 1;
  v_policy_found := found;
  v_key := 'campaign_response:' || new.id::text || ':market_fit_outcome:v1';

  insert into local_intel.intelligence_outcomes(
    outcome_key,decision_id,action_id,outcome_kind,outcome_class,outcome_score,
    interpretation_state,scoring_policy_key,evidence_source_kind,evidence_ref,
    occurred_at,evidence_snapshot,metadata
  ) values (
    v_key,
    v_decision_id,
    new.preceding_action_id,
    new.event_type,
    new.event_type,
    case when v_policy_found then v_policy.outcome_score else null end,
    case when v_policy_found then v_policy.interpretation_state else 'unmapped' end,
    case when v_policy_found then v_policy.policy_key else null end,
    'campaign_response_event',
    new.id::text,
    new.occurred_at,
    jsonb_build_object(
      'campaign_id',new.campaign_id,
      'campaign_target_id',new.campaign_target_id,
      'campaign_contact_id',new.campaign_contact_id,
      'preceding_action_id',new.preceding_action_id,
      'source',new.source,
      'notes',new.notes,
      'event_data',coalesce(new.event_data,'{}'::jsonb)
    ),
    jsonb_build_object(
      'bridge_version','1.1',
      'action_relationship',case
        when new.preceding_action_id is null then 'unlinked'
        else 'preceding_campaign_execution_not_causal_attribution'
      end
    )
  )
  on conflict (outcome_key) do nothing
  returning id into v_outcome_id;

  if v_outcome_id is null then
    select id into v_outcome_id
    from local_intel.intelligence_outcomes
    where outcome_key=v_key;
  end if;

  perform local_intel.evaluate_intelligence_outcome_v1(v_outcome_id);
  return new;
end;
$function$;

create or replace function local_intel.record_campaign_outreach_execution_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  t local_intel.campaign_targets%rowtype;
  c local_intel.campaign_contacts%rowtype;
  v_target_id uuid;
  v_contact_id uuid;
  v_decision_id uuid;
  v_action_id uuid;
  v_execution_key text := nullif(btrim(p_payload->>'execution_key'),'');
  v_actor_kind text := nullif(btrim(p_payload->>'actor_kind'),'');
  v_channel text := nullif(btrim(p_payload->>'channel'),'');
  v_occurred_at timestamptz := coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,now());
  v_action_key text;
begin
  begin
    v_target_id := (p_payload->>'campaign_target_id')::uuid;
  exception when invalid_text_representation or null_value_not_allowed then
    raise exception 'campaign_target_id must be UUID';
  end;

  begin
    v_contact_id := nullif(p_payload->>'campaign_contact_id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'campaign_contact_id must be UUID';
  end;

  if v_execution_key is null then raise exception 'execution_key is required'; end if;
  if length(v_execution_key) > 200 then raise exception 'execution_key must be 200 characters or fewer'; end if;
  if v_actor_kind is null then raise exception 'actor_kind is required'; end if;
  if v_channel is null then raise exception 'channel is required'; end if;

  select * into t from local_intel.campaign_targets where id=v_target_id;
  if not found then raise exception 'Unknown campaign target %',v_target_id; end if;

  if t.marketing_clearance_state <> 'eligible' then
    raise exception 'Campaign target % is not marketing-clearance eligible',t.id;
  end if;
  if t.target_state not in ('send_eligible','in_market') then
    raise exception 'Campaign target % is not in an executable outreach state: %',t.id,t.target_state;
  end if;

  if v_contact_id is not null then
    select * into c from local_intel.campaign_contacts where id=v_contact_id;
    if not found then raise exception 'Unknown campaign contact %',v_contact_id; end if;
    if c.campaign_id is distinct from t.campaign_id
       or c.campaign_target_id is distinct from t.id
       or c.entity_id is distinct from t.organization_entity_id then
      raise exception 'Campaign contact % does not belong to target %',c.id,t.id;
    end if;
    if c.state not in ('eligible','queued','contacted') then
      raise exception 'Campaign contact % is not executable from state %',c.id,c.state;
    end if;
  end if;

  v_decision_id := local_intel.capture_campaign_target_decision_v1(t.id);
  v_action_key := 'campaign_outreach:' || t.id::text || ':' || v_execution_key;

  v_action_id := local_intel.record_intelligence_action_v1(jsonb_build_object(
    'action_key',v_action_key,
    'decision_id',v_decision_id,
    'action_kind','campaign_outreach',
    'action_state','executed',
    'actor_kind',v_actor_kind,
    'actor_ref',nullif(p_payload->>'actor_ref',''),
    'channel',v_channel,
    'occurred_at',v_occurred_at,
    'action_snapshot',jsonb_build_object(
      'campaign_id',t.campaign_id,
      'campaign_target_id',t.id,
      'campaign_contact_id',v_contact_id,
      'organization_entity_id',t.organization_entity_id,
      'offering_use_case_id',t.offering_use_case_id,
      'marketing_clearance_state',t.marketing_clearance_state,
      'target_state_before_execution',t.target_state,
      'execution_key',v_execution_key,
      'execution_evidence',coalesce(p_payload->'evidence_snapshot','{}'::jsonb)
    ),
    'metadata',jsonb_build_object(
      'campaign_execution_membrane_version','1.0',
      'explicit_execution_record',true,
      'state_transition_is_consequence_not_evidence',true
    )
  ));

  if t.target_state='send_eligible' then
    update local_intel.campaign_targets
    set target_state='in_market',updated_at=now()
    where id=t.id and target_state='send_eligible';
  end if;

  if v_contact_id is not null then
    update local_intel.campaign_contacts
    set state='contacted',last_action_at=v_occurred_at,updated_at=now()
    where id=v_contact_id and state in ('eligible','queued','contacted');
  end if;

  return v_action_id;
end;
$function$;

create or replace function local_intel.record_campaign_response_event_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','local_intel'
as $function$
declare
  t local_intel.campaign_targets%rowtype;
  v_target_id uuid;
  v_contact_id uuid;
  v_action_id uuid;
  v_event_id uuid;
  v_event_type text := nullif(btrim(p_payload->>'event_type'),'');
  v_occurred_at timestamptz := coalesce(nullif(p_payload->>'occurred_at','')::timestamptz,now());
begin
  begin
    v_target_id := (p_payload->>'campaign_target_id')::uuid;
  exception when invalid_text_representation or null_value_not_allowed then
    raise exception 'campaign_target_id must be UUID';
  end;
  begin
    v_contact_id := nullif(p_payload->>'campaign_contact_id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'campaign_contact_id must be UUID';
  end;
  begin
    v_action_id := nullif(p_payload->>'preceding_action_id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'preceding_action_id must be UUID';
  end;
  if v_event_type is null then raise exception 'event_type is required'; end if;

  select * into t from local_intel.campaign_targets where id=v_target_id;
  if not found then raise exception 'Unknown campaign target %',v_target_id; end if;

  insert into local_intel.campaign_response_events(
    campaign_id,campaign_target_id,campaign_contact_id,preceding_action_id,
    event_type,occurred_at,source,notes,event_data
  ) values (
    t.campaign_id,v_target_id,v_contact_id,v_action_id,
    v_event_type,v_occurred_at,nullif(p_payload->>'source',''),nullif(p_payload->>'notes',''),
    coalesce(p_payload->'event_data','{}'::jsonb)
  ) returning id into v_event_id;

  return v_event_id;
end;
$function$;

revoke execute on function local_intel.block_campaign_response_event_mutation_v1() from public,anon,authenticated,service_role;
revoke execute on function local_intel.validate_campaign_response_event_v1() from public,anon,authenticated,service_role;
revoke execute on function local_intel.capture_campaign_response_outcome_v1() from public,anon,authenticated,service_role;
revoke execute on function local_intel.record_campaign_outreach_execution_v1(jsonb) from public,anon,authenticated;
revoke execute on function local_intel.record_campaign_response_event_v1(jsonb) from public,anon,authenticated;
grant execute on function local_intel.record_campaign_outreach_execution_v1(jsonb) to service_role;
grant execute on function local_intel.record_campaign_response_event_v1(jsonb) to service_role;
