import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const resource = readFileSync(
  "supabase/migrations/20260818162107_operation_result_generic_resource_event_state_v1.sql",
  "utf8",
);
const mower = readFileSync(
  "supabase/migrations/20260818162410_operation_result_mower_reusable_resource_specimen_v1.sql",
  "utf8",
);
const unknown = readFileSync(
  "supabase/migrations/20260818162519_operation_result_resource_unknown_requirement_semantics_v1.sql",
  "utf8",
);

test("OR2 adds an append-only generic resource ledger without replacing domain-owned inventory", () => {
  assert.match(resource, /create table if not exists atlas\.resource_events/i);
  assert.match(resource, /create table if not exists atlas\.resource_operational_state/i);
  assert.match(resource, /Generic resource events are append-only/i);
  assert.match(resource, /Does not replace domain-specific seed or Harvest events/i);
  assert.match(resource, /generic_event_state_enabled/i);
});

test("generic resource state preserves unknown until evidence establishes readiness", () => {
  assert.match(resource, /readiness_state text not null default 'unknown'/i);
  assert.match(resource, /when 'unknown' then 'unknown'/i);
  assert.match(resource, /state\.readiness_state='ready'/i);
  assert.match(unknown, /readiness_state='unknown' then 'needs_check'/i);
  assert.match(unknown, /readiness is unknown; verify before execution/i);
});

test("mower battery set is modeled as one reusable two-battery working set", () => {
  assert.match(mower, /battery_push_mower_battery_set/i);
  assert.match(mower, /battery_count',2/i);
  assert.match(mower, /two_batteries_used_together_as_one_working_set/i);
  assert.match(mower, /'unknown','not_applicable'/i);
  assert.match(mower, /No current witness establishes charged readiness/i);
});

test("battery-push mowing is normalized to the governed 3-inch cut height", () => {
  assert.match(mower, /'target_cut_height_inches',3/i);
  assert.match(mower, /target_cut_height_inches=3/i);
  assert.match(mower, /v_height_text:='3'/i);
  assert.match(mower, /Battery push mower/i);
});

test("Follow-Me and Curve Garden TRAVELS_WITH stays scheduling affinity only", () => {
  assert.match(mower, /'travels_with'/i);
  assert.match(mower, /battery_push_mower:follow_me_curve/i);
  assert.match(mower, /scheduling_affinity_only/i);
  assert.match(mower, /does_not_imply_prerequisite',true/i);
  assert.match(mower, /does_not_share_completion',true/i);
  assert.match(mower, /does_not_merge_task_identity',true/i);
  assert.match(mower, /isPrerequisite',false/i);
  assert.match(mower, /sharesCompletion',false/i);
  assert.match(mower, /mergesTaskIdentity',false/i);
});

test("same-day affinity pair consumes exactly one idempotent charge key", () => {
  assert.match(mower, /one_full_charge_per_local_service_day/i);
  assert.match(mower, /mowing-charge:affinity:/i);
  assert.match(resource, /unique\(resource_id,idempotency_key\)/i);
  assert.match(mower, /sharedAffinityDeduplicatesOneCharge/i);
});

test("mowing completion remains true while battery reset is a separate continuation", () => {
  assert.match(mower, /charge_consumed/i);
  assert.match(resource, /v_readiness:='needs_charge'/i);
  assert.match(resource, /Good work\. Charge the batteries for next time!/i);
  assert.match(resource, /Batteries plugged in/i);
  assert.match(resource, /charging_started/i);
  assert.match(resource, /ready_confirmed/i);
  assert.match(mower, /mowingCompletionRemainsComplete',true/i);
  assert.match(mower, /resetIsSeparateOperation',true/i);
  assert.match(mower, /Mowing result was preserved but the reusable-resource consequence could not be applied/i);
});

test("future mower executability consumes event-derived resource readiness", () => {
  assert.match(resource, /resource_ready_for_requirement_v1/i);
  assert.match(resource, /state\.readiness_state='ready'/i);
  assert.match(resource, /task_required_resources_available_v1/i);
  assert.match(mower, /required_resource_keys/i);
  assert.match(mower, /battery_push_mower_battery_set/i);
});

test("authenticated reset action is narrow while resource effect writers remain service-only", () => {
  assert.match(resource, /record_resource_reset_for_member_v1/i);
  assert.match(resource, /grant execute on function atlas\.record_resource_reset_for_member_v1[\s\S]*to authenticated,service_role/i);
  assert.match(resource, /revoke all on function atlas\.record_resource_event_v1[\s\S]*from public,anon,authenticated/i);
  assert.match(mower, /apply_mowing_resource_effect_v1/i);
  assert.match(mower, /grant execute on function atlas\.apply_mowing_resource_effect_v1[\s\S]*to service_role/i);
  assert.match(mower, /atlas\.record_resource_reset_for_member_v1\(uuid, uuid, text, text, text\)/i);
});
