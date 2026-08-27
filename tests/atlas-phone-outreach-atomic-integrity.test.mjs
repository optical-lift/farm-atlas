import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const component = fs.readFileSync("components/atlas/phone-outreach-task-detail.tsx", "utf8");
const route = fs.readFileSync("app/api/atlas/phone-outreach/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260827005000_atlas_phone_outreach_atomic_completion_v2.sql", "utf8");
const callerBinding = fs.readFileSync("supabase/migrations/20260827005500_atlas_phone_outreach_atomic_caller_binding_v2.sql", "utf8");

test("phone outreach submits one atomic child-result command", () => {
  assert.match(component, /x-atlas-intent": "phone-outreach-v2"/);
  assert.match(component, /idempotencyKey: submissionKey\(contact\.task_id\)/);
  assert.doesNotMatch(component, /transition: "checklist_done"/);
  assert.doesNotMatch(component, /transition: "checklist_open"/);
  assert.doesNotMatch(component, /transition: "note"/);
});

test("phone outreach API requires idempotency and uses the atomic RPC", () => {
  assert.match(route, /phone-outreach-v2/);
  assert.match(route, /phone_outreach_submission_key_required/);
  assert.match(route, /record_phone_outreach_result_and_complete_v2/);
  assert.match(route, /p_idempotency_key: idempotencyKey/);
});

test("database custody joins intelligence write and child completion", () => {
  assert.match(migration, /record_phone_outreach_result_and_complete_v2/);
  assert.match(migration, /local_intel\.campaign_contacts/);
  assert.match(migration, /atlas\.record_task_transition_v1/);
  assert.match(migration, /'checklist_done'/);
  assert.match(migration, /v_scoped_key := v_task\.id::text \|\| ':' \|\| md5\(p_idempotency_key\)/);
});

test("atomic phone outreach is bound to the signed-in farm identity", () => {
  assert.match(callerBinding, /auth\.uid\(\) is null/);
  assert.match(callerBinding, /v_membership_user_id is distinct from auth\.uid\(\)/);
  assert.match(callerBinding, /v_parent\.assigned_membership_id is distinct from p_effective_membership_id/);
});

test("phone outreach parent cannot close before every call has a recorded result", () => {
  assert.match(migration, /guard_phone_outreach_parent_completion_v1/);
  assert.match(migration, /phone_outreach_master_task/);
  assert.match(migration, /expected_call_count/);
  assert.match(migration, /phone_outreach_result/);
  assert.match(migration, /record a call result for every released contact first/);
});
