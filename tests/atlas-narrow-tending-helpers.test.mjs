import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260731212000_atlas_narrow_tending_helpers_v1.sql",
  import.meta.url,
);
const sql = readFileSync(migrationPath, "utf8");
const normalized = sql.replace(/\s+/g, " ").trim();

const reviewedHelpers = [
  "atlas.tending_action_key_v1",
  "atlas.tending_action_label_v1",
  "atlas.tending_card_json_v1",
  "atlas.tending_card_json_v2",
  "atlas.tending_gates_v1",
  "atlas.tending_unlock_label_v1",
];

const parentSurfaces = [
  "atlas.tending_board_v1(uuid, text, date)",
  "atlas.tending_bed_v1(uuid, text, text)",
  "atlas.tending_task_context_v1(uuid, uuid, text)",
  "atlas.tending_task_context_v2(uuid, uuid, text, text)",
];

test("migration revokes exactly six reviewed Tending helpers", () => {
  for (const helper of reviewedHelpers) {
    assert.match(
      normalized,
      new RegExp(`REVOKE EXECUTE ON FUNCTION ${helper.replaceAll(".", "\\.")}`, "i"),
    );
  }

  assert.equal(
    (normalized.match(/REVOKE EXECUTE ON FUNCTION/gi) ?? []).length,
    reviewedHelpers.length,
  );
});

test("migration freezes the Tending caller closure", () => {
  for (const surface of parentSurfaces) {
    assert.ok(sql.includes(surface), `missing parent caller gate for ${surface}`);
  }

  assert.match(normalized, /actual_callers IS DISTINCT FROM expected\.expected_callers/i);
  assert.match(normalized, /tending_profile_gates_v1\(uuid,date\)/i);
  assert.match(normalized, /profile_callers IS DISTINCT FROM ARRAY/i);
  assert.match(normalized, /non-definer external caller/i);
  assert.match(normalized, /policy_reference_count <> 0/i);
});

test("migration consumes and updates the governed registry", () => {
  assert.match(normalized, /authenticated_rpc_registry_drift_v1\(\)/i);
  assert.match(normalized, /classification <> 'service_internal'/i);
  assert.match(normalized, /review_status <> 'pending_revoke'/i);
  assert.match(normalized, /authenticated_execute_expected = FALSE/i);
  assert.match(normalized, /review_status = 'revoked'/i);
  assert.match(normalized, /pending_internal_count <> 17/i);
  assert.match(normalized, /drift_count <> 0/i);
});

test("service access and parent payload proof are preserved", () => {
  assert.match(
    normalized,
    /NOT has_function_privilege\('service_role', helper_oid, 'EXECUTE'\)/i,
  );
  assert.match(normalized, /exact_parent_payload_proof', TRUE/i);
  assert.match(normalized, /'proof_roles', jsonb_build_array\('owner', 'farm_hand'\)/i);
  for (const surface of [
    "tending_board_v1",
    "tending_bed_v1",
    "tending_task_context_v1",
    "tending_task_context_v2",
  ]) {
    assert.ok(sql.includes(`'${surface}'`));
  }
});

test("boundary-only migration does not redefine functions or add grants", () => {
  assert.doesNotMatch(normalized, /CREATE OR REPLACE FUNCTION/i);
  assert.doesNotMatch(normalized, /ALTER FUNCTION/i);
  assert.doesNotMatch(normalized, /GRANT EXECUTE/i);
  assert.doesNotMatch(
    sql,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
});
