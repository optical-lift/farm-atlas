import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260823003250_communication_authority_and_sender_health_v1.sql", import.meta.url),
  "utf8",
);

const authority = migration.match(
  /create or replace function local_intel\.get_communication_authority_v1\(p_payload jsonb\)[\s\S]*?\nend;\n\$function\$;/i,
)?.[0] ?? "";

const receiptV2 = migration.match(
  /create or replace function local_intel\.record_campaign_email_send_receipt_v2\(p_payload jsonb\)[\s\S]*?\nend;\n\$function\$;/i,
)?.[0] ?? "";

test("communication purpose is first-class and separates four outbound lanes", () => {
  for (const key of ["conversation", "transactional", "subscribed_marketing", "prospecting"]) {
    assert.match(migration, new RegExp(`'${key}'`, "i"));
  }
  assert.match(migration, /requires_explicit_opt_in/i);
  assert.match(migration, /is_marketing/i);
});

test("provider class is governed separately from communication purpose", () => {
  assert.match(migration, /provider_class in \('mailbox','transactional_esp','marketing_esp'\)/i);
  assert.match(migration, /'subscribed_marketing','marketing_esp',true,true,false/i);
  assert.match(migration, /'subscribed_marketing','mailbox',false,false,true/i);
  assert.match(migration, /'prospecting','mailbox',true,false,true/i);
  assert.match(migration, /'prospecting','marketing_esp',false,false,true/i);
});

test("Gmail is truthfully registered as not connected rather than treated as an Atlas integration", () => {
  assert.match(migration, /'gmail','mailbox','oauth_mailbox','Gmail'/i);
  assert.match(migration, /'gmail','not_connected','migration_initial_state'/i);
  assert.match(migration, /no Atlas-owned Gmail OAuth connection yet/i);
  assert.match(authority, /provider_not_connected/i);
});

test("relationship basis is purpose-specific", () => {
  assert.match(migration, /'conversation','existing_correspondence'/i);
  assert.match(migration, /'transactional','existing_customer'/i);
  assert.match(migration, /'subscribed_marketing','subscriber_opt_in'/i);
  assert.match(migration, /'prospecting','public_business_prospect'/i);
  assert.match(authority, /relationship_basis_not_authorized_for_class/i);
});

test("marketing suppression is purpose-specific and does not silently suppress transactional mail", () => {
  assert.match(authority, /if v_is_marketing and cp\.marketing_status <> 'eligible'/i);
  assert.match(authority, /case when v_is_marketing then 'marketing' else '__not_marketing__' end/i);
  assert.match(authority, /marketing_opt_out_does_not_silently_block_transactional_or_conversation/i);
});

test("subscribed marketing requires explicit opt-in while prospecting requires a public governed route", () => {
  assert.match(authority, /if v_requires_optin then/i);
  assert.match(authority, /x\.basis='explicit_opt_in'/i);
  assert.match(authority, /explicit_opt_in_required/i);
  assert.match(authority, /if v_class='prospecting' and cp\.visibility <> 'public'/i);
  assert.match(authority, /prospecting_requires_public_contact_route/i);
});

test("global and channel do-not-contact remain hard stops", () => {
  assert.match(authority, /v_pref='do_not_contact'/i);
  assert.match(authority, /entity_channel_do_not_contact/i);
  assert.match(authority, /communication_permission_denied/i);
  assert.match(authority, /contact_point_suppressed/i);
});

test("sender health is empirical, append-only, and can pause authority", () => {
  assert.match(migration, /communication_sender_health_events/i);
  assert.match(migration, /hard_bounce/i);
  assert.match(migration, /complaint/i);
  assert.match(migration, /provider_pause/i);
  assert.match(migration, /communication_sender_health_events_append_only_v1/i);
  assert.match(authority, /sender_health_paused/i);
  assert.match(authority, /sender_health_insufficient_sample/i);
});

test("initial prospecting velocity thresholds are governance limits, not claimed provider limits", () => {
  assert.match(migration, /'prospecting','mailbox',10,30,20,0\.05,0\.001,'pilot_conservative_v1'/i);
  assert.match(migration, /Atlas governance thresholds, not provider-published sending limits/i);
});

test("machine execution depends on class policy and healthy sender evidence", () => {
  assert.match(authority, /pp\.machine_execution_allowed/i);
  assert.match(authority, /pp\.human_authorization_required/i);
  assert.match(authority, /h\.health_state,'insufficient_sample'\)='healthy'/i);
  assert.match(authority, /machine_send_allowed/i);
});

test("communication governance history is append-only", () => {
  for (const table of [
    "communication_provider_connection_events",
    "communication_permission_events",
    "communication_sender_health_events",
    "communication_authority_assessments",
  ]) {
    assert.match(migration, new RegExp(`${table}_append_only_v1`, "i"));
  }
  assert.match(migration, /communication governance history is append-only/i);
});

test("campaign Gmail v2 requires a connected governed sender and explicit human authorization", () => {
  assert.match(receiptV2, /sender_identity_id/i);
  assert.match(receiptV2, /Sender address does not match governed sender identity/i);
  assert.match(receiptV2, /human_authorization_reference is required for this communication class/i);
  assert.match(receiptV2, /record_communication_authority_assessment_v1/i);
  assert.match(receiptV2, /record_communication_sender_health_event_v1/i);
  assert.match(receiptV2, /'event_type','accepted'/i);
});

test("legacy campaign receipt writer cannot bypass communication authority", () => {
  assert.match(migration, /revoke execute on function local_intel\.record_campaign_email_send_receipt_v1\(jsonb\) from service_role/i);
  assert.match(migration, /grant execute on function local_intel\.record_campaign_email_send_receipt_v2\(jsonb\) to service_role/i);
});

test("communication writes stay behind service-only functions rather than direct table DML", () => {
  for (const fn of [
    "record_communication_authority_assessment_v1",
    "record_communication_permission_event_v1",
    "record_communication_provider_connection_event_v1",
    "register_communication_sender_identity_v1",
    "record_communication_sender_health_event_v1",
  ]) {
    assert.ok(
      migration.toLowerCase().includes(`grant execute on function local_intel.${fn}(jsonb) to service_role`),
      `${fn} must remain service-only`,
    );
  }
  for (const table of [
    "communication_permission_events",
    "communication_sender_health_events",
    "communication_authority_assessments",
  ]) {
    assert.ok(
      migration.toLowerCase().includes(`revoke all on local_intel.${table} from public,anon,authenticated`),
      `${table} must not expose direct public/anon/authenticated DML`,
    );
    assert.ok(
      migration.toLowerCase().includes(`revoke all on local_intel.${table} from service_role`),
      `${table} must not expose direct service-role DML`,
    );
  }
});
