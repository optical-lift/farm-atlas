import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDirectory), "utf8");

const gmail = readMigration("20260823000551_campaign_gmail_send_receipt_membrane_v1.sql");
const attribution = readMigration("20260822234736_campaign_execution_outcome_attribution_v1.sql");

const packet = gmail.match(/create or replace function local_intel\.get_campaign_email_send_packet_v1\([\s\S]*?\n\$function\$;/i)?.[0] ?? "";
const receipt = gmail.match(/create or replace function local_intel\.record_campaign_email_send_receipt_v1\([\s\S]*?\n\$function\$;/i)?.[0] ?? "";

test("campaign Gmail transport has an immutable provider receipt ledger", () => {
  assert.match(gmail, /create table if not exists local_intel\.campaign_send_receipts/i);
  assert.match(gmail, /unique\(provider,provider_message_id\)/i);
  assert.match(gmail, /unique\(action_id\)/i);
  assert.match(gmail, /before update or delete on local_intel\.campaign_send_receipts/i);
  assert.match(gmail, /campaign send receipts are append-only provider evidence/i);
});

test("send readiness requires campaign target contact point and rendered asset clearance", () => {
  assert.match(packet, /cam\.status not in \('ready','active'\)/i);
  assert.match(packet, /marketing_clearance_state <> 'eligible'/i);
  assert.match(packet, /target_state not in \('send_eligible','in_market'\)/i);
  assert.match(packet, /c\.state not in \('eligible','queued','contacted'\)/i);
  assert.match(packet, /cp\.contact_type <> 'email'/i);
  assert.match(packet, /cp\.visibility <> 'public'/i);
  assert.match(packet, /cp\.marketing_status <> 'eligible'/i);
  assert.match(packet, /cp\.suppression_reason is not null/i);
  assert.match(packet, /a\.status <> 'approved'/i);
  assert.match(packet, /a\.channel <> 'email'/i);
  assert.match(packet, /a\.asset_kind <> 'email_message'/i);
});

test("approved message body is frozen by a server-computed SHA-256 digest", () => {
  assert.match(packet, /extensions\.digest\(v_body,'sha256'\)/i);
  assert.match(packet, /'body_sha256',v_body_hash/i);
  assert.match(receipt, /body_sha256 must be a lowercase SHA-256 hex digest/i);
  assert.match(receipt, /Provider body hash does not match approved campaign message/i);
});

test("Gmail receipt identity must match the governed recipient subject and message body", () => {
  assert.match(receipt, /v_provider <> 'gmail'/i);
  assert.match(receipt, /Provider recipient does not match governed campaign contact point/i);
  assert.match(receipt, /Provider subject does not match approved campaign message/i);
  assert.match(receipt, /Provider body hash does not match approved campaign message/i);
});

test("provider receipt becomes an executed outreach action only through the existing authority membrane", () => {
  assert.match(receipt, /record_campaign_outreach_execution_v1\(jsonb_build_object/i);
  assert.match(receipt, /'execution_key',v_execution_key/i);
  assert.match(receipt, /'channel','email'/i);
  assert.match(attribution, /record_intelligence_action_v1\(jsonb_build_object/i);
  assert.doesNotMatch(receipt, /insert into local_intel\.intelligence_actions/i);
});

test("Gmail message id is the durable idempotency identity for a send", () => {
  assert.match(receipt, /where provider=v_provider and provider_message_id=v_message_id/i);
  assert.match(receipt, /idempotent_replay',true/i);
  assert.match(receipt, /v_execution_key := v_provider \|\| ':' \|\| v_message_id/i);
  assert.match(receipt, /already belongs to a different immutable campaign send receipt/i);
});

test("transport evidence never overclaims delivery reading response or causality", () => {
  assert.match(receipt, /provider-confirmed transport receipt; not proof of delivery, reading, response, or causality/i);
  assert.match(receipt, /transport_receipt_is_not_delivery_or_response',true/i);
  assert.match(packet, /send_ready_is_not_execution',true/i);
});

test("campaign send packet and receipt writer stay service-only with no direct receipt mutation path", () => {
  assert.match(gmail, /revoke all on table local_intel\.campaign_send_receipts from public,anon,authenticated,service_role/i);
  assert.match(gmail, /grant select on table local_intel\.campaign_send_receipts to service_role/i);
  assert.match(gmail, /revoke execute on function local_intel\.get_campaign_email_send_packet_v1\(uuid\) from public,anon,authenticated/i);
  assert.match(gmail, /revoke execute on function local_intel\.record_campaign_email_send_receipt_v1\(jsonb\) from public,anon,authenticated/i);
  assert.match(gmail, /grant execute on function local_intel\.get_campaign_email_send_packet_v1\(uuid\) to service_role/i);
  assert.match(gmail, /grant execute on function local_intel\.record_campaign_email_send_receipt_v1\(jsonb\) to service_role/i);
  assert.doesNotMatch(gmail, /grant\s+(insert|update|delete)\s+on\s+table\s+local_intel\.campaign_send_receipts\s+to\s+service_role/i);
});
