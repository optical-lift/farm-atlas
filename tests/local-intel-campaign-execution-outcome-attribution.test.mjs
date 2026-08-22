import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDirectory), "utf8");

const attribution = readMigration("20260822234736_campaign_execution_outcome_attribution_v1.sql");
const authority = readMigration("20260822220716_intelligence_confidence_abstention_authority_v1.sql");

const outreachWriter = attribution.match(/create or replace function local_intel\.record_campaign_outreach_execution_v1\([\s\S]*?\n\$function\$;/i)?.[0] ?? "";
const responseGuard = attribution.match(/create or replace function local_intel\.validate_campaign_response_event_v1\(\)[\s\S]*?\n\$function\$;/i)?.[0] ?? "";
const responseBridge = attribution.match(/create or replace function local_intel\.capture_campaign_response_outcome_v1\(\)[\s\S]*?\n\$function\$;/i)?.[0] ?? "";

test("campaign response evidence carries an explicit preceding intelligence action link", () => {
  assert.match(attribution, /add column if not exists preceding_action_id uuid references local_intel\.intelligence_actions\(id\) on delete restrict/i);
  assert.match(attribution, /campaign_response_events_preceding_action_idx/i);
  assert.match(responseBridge, /new\.preceding_action_id/i);
  assert.match(responseBridge, /'preceding_campaign_execution_not_causal_attribution'/i);
});

test("response events are append-only evidence rather than mutable learning inputs", () => {
  assert.match(attribution, /campaign response events are append-only evidence/i);
  assert.match(attribution, /before update or delete on local_intel\.campaign_response_events/i);
  assert.match(attribution, /campaign_response_events_append_only_v1/i);
});

test("outreach execution is an explicit governed action, never inferred from contacted state", () => {
  assert.match(outreachWriter, /record_intelligence_action_v1\(jsonb_build_object/i);
  assert.match(outreachWriter, /'action_kind','campaign_outreach'/i);
  assert.match(outreachWriter, /'action_state','executed'/i);
  assert.match(outreachWriter, /'explicit_execution_record',true/i);
  assert.match(outreachWriter, /'state_transition_is_consequence_not_evidence',true/i);
  assert.doesNotMatch(attribution, /create trigger[^;]*campaign_contacts[^;]*record_campaign_outreach_execution_v1/is);
  assert.doesNotMatch(attribution, /insert into local_intel\.intelligence_actions/i);
});

test("outreach cannot execute without marketing clearance and an executable target state", () => {
  assert.match(outreachWriter, /marketing_clearance_state <> 'eligible'/i);
  assert.match(outreachWriter, /target_state not in \('send_eligible','in_market'\)/i);
  assert.match(outreachWriter, /campaign contact % is not executable from state %/i);
  assert.match(outreachWriter, /set target_state='in_market'/i);
  assert.match(outreachWriter, /set state='contacted',last_action_at=v_occurred_at/i);
});

test("machine execution remains subordinate to the existing authority membrane", () => {
  assert.match(outreachWriter, /record_intelligence_action_v1/i);
  assert.match(authority, /v_action_state='executed' and v_actor_class='machine'/i);
  assert.match(authority, /Machine execution not authorized/i);
  assert.match(authority, /actor_execution_class/i);
});

test("response identity is exact across campaign target contact and organization", () => {
  assert.match(responseGuard, /new\.campaign_id is distinct from t\.campaign_id/i);
  assert.match(responseGuard, /c\.campaign_id is distinct from t\.campaign_id/i);
  assert.match(responseGuard, /c\.campaign_target_id is distinct from t\.id/i);
  assert.match(responseGuard, /c\.entity_id is distinct from t\.organization_entity_id/i);
});

test("a linked response action must be the executed outreach for the same decision and precede the response", () => {
  assert.match(responseGuard, /a\.decision_id is distinct from v_decision_id/i);
  assert.match(responseGuard, /a\.action_state <> 'executed'/i);
  assert.match(responseGuard, /a\.action_kind <> 'campaign_outreach'/i);
  assert.match(responseGuard, /a\.occurred_at > new\.occurred_at/i);
  assert.match(responseGuard, /action_snapshot->>'campaign_target_id'/i);
});

test("probability-scored market-fit evidence cannot train without the exact preceding outreach action", () => {
  assert.match(responseGuard, /p\.outcome_score is not null/i);
  assert.match(responseGuard, /d\.predicted_probability is not null/i);
  assert.match(responseGuard, /new\.preceding_action_id is null/i);
  assert.match(responseGuard, /requires the exact preceding campaign outreach action/i);
});

test("operational and ambiguous response events remain preservable without being silently scored", () => {
  assert.match(responseBridge, /case when v_policy_found then v_policy\.outcome_score else null end/i);
  assert.match(responseBridge, /case when v_policy_found then v_policy\.interpretation_state else 'unmapped' end/i);
  assert.match(responseBridge, /perform local_intel\.evaluate_intelligence_outcome_v1\(v_outcome_id\)/i);
});

test("campaign execution and response writes remain service-only behind the private local-intel membrane", () => {
  assert.match(attribution, /revoke execute on function local_intel\.record_campaign_outreach_execution_v1\(jsonb\) from public,anon,authenticated/i);
  assert.match(attribution, /revoke execute on function local_intel\.record_campaign_response_event_v1\(jsonb\) from public,anon,authenticated/i);
  assert.match(attribution, /grant execute on function local_intel\.record_campaign_outreach_execution_v1\(jsonb\) to service_role/i);
  assert.match(attribution, /grant execute on function local_intel\.record_campaign_response_event_v1\(jsonb\) to service_role/i);
  assert.match(attribution, /revoke execute on function local_intel\.validate_campaign_response_event_v1\(\) from public,anon,authenticated,service_role/i);
  assert.doesNotMatch(attribution, /grant\s+usage\s+on\s+schema\s+local_intel/i);
});
