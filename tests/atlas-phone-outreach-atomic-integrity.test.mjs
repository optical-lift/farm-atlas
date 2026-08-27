import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const component = fs.readFileSync("components/atlas/phone-outreach-task-detail.tsx", "utf8");
const route = fs.readFileSync("app/api/atlas/phone-outreach/route.ts", "utf8");

test("phone outreach submits one atomic child-result command", () => {
  assert.match(component, /x-atlas-intent": "phone-outreach-v2"/);
  assert.match(component, /idempotencyKey: submissionKey\(contact\.task_id\)/);
  assert.doesNotMatch(component, /transition: "checklist_done"/);
  assert.doesNotMatch(component, /transition: "checklist_open"/);
  assert.doesNotMatch(component, /transition: "note"/);
});

test("phone outreach API requires idempotency and delegates to the governed atomic RPC", () => {
  assert.match(route, /phone-outreach-v2/);
  assert.match(route, /phone_outreach_submission_key_required/);
  assert.match(route, /record_phone_outreach_result_and_complete_v2/);
  assert.match(route, /p_idempotency_key: idempotencyKey/);
  assert.match(route, /phone_outreach_not_authorized_today/);
});
