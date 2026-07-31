import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const indexMigration = read(
  "supabase/migrations/20260731194000_atlas_optimize_hot_path_indexes_v1.sql",
);
const rlsMigration = read(
  "supabase/migrations/20260731194100_atlas_optimize_rls_initplans_v1.sql",
);

const reviewedIndexes = [
  "tasks_assigned_membership_id_idx",
  "tasks_created_by_user_id_idx",
  "tasks_release_policy_id_idx",
  "tasks_zone_id_idx",
  "growing_objects_zone_id_idx",
  "projects_farm_id_idx",
  "projects_zone_id_idx",
];

const reviewedPolicies = [
  "user_profiles_read_self",
  "farm_memberships_read_self",
  "organization_memberships_read_self",
  "tasks_read_project_contributor",
  "bell_event_receipts_read_own",
  "bell_visit_state_read_own",
  "push_subscriptions_own_read",
  "notification_preferences_own_read",
  "notification_outbox_own_read",
  "notification_deliveries_own_read",
  "bell_monitoring_baselines_read_own",
];

test("the index migration creates only the seven reviewed relationship indexes", () => {
  const created = [
    ...indexMigration.matchAll(/^create\s+index\s+([a-z0-9_]+)/gim),
  ].map((match) => match[1]);

  assert.deepEqual(created.sort(), [...reviewedIndexes].sort());

  const dropped = [
    ...indexMigration.matchAll(/^drop\s+index\s+([^;]+);/gim),
  ].map((match) => match[1].trim());

  assert.deepEqual(dropped, ["atlas.tasks_one_active_engine_instance_uidx"]);
  assert.match(indexMigration, /atlas\.tasks_active_engine_instance_idx/);
});

test("duplicate-index removal is dependency and structure gated", () => {
  assert.match(indexMigration, /conindid\s*=\s*dropped_oid/);
  assert.match(indexMigration, /kept\.indkey\s*=\s*duplicate\.indkey/);
  assert.match(indexMigration, /kept\.indclass\s*=\s*duplicate\.indclass/);
  assert.match(indexMigration, /pg_get_expr\(kept\.indpred/);
  assert.match(indexMigration, /no longer structurally identical/);
});

test("every new index is bound to its reviewed foreign key and postcondition", () => {
  for (const indexName of reviewedIndexes) {
    assert.match(indexMigration, new RegExp(indexName, "g"));
  }

  for (const constraintName of [
    "tasks_assigned_membership_id_fkey",
    "tasks_created_by_user_id_fkey",
    "tasks_release_policy_id_fkey",
    "tasks_zone_id_fkey",
    "growing_objects_zone_id_fkey",
    "projects_farm_id_fkey",
    "projects_zone_id_fkey",
  ]) {
    assert.match(indexMigration, new RegExp(constraintName));
  }

  assert.match(indexMigration, /indisvalid/);
  assert.match(indexMigration, /indisready/);
  assert.match(indexMigration, /indnatts\s*=\s*1/);
});

test("the RLS migration alters exactly the eleven reviewed policies", () => {
  const altered = [
    ...rlsMigration.matchAll(/^alter\s+policy\s+([a-z0-9_]+)/gim),
  ].map((match) => match[1]);

  assert.deepEqual(altered.sort(), [...reviewedPolicies].sort());

  const simpleWrappers = [
    ...rlsMigration.matchAll(
      /using\s*\(user_id\s*=\s*\(select\s+auth\.uid\(\)\)\);/gim,
    ),
  ];
  assert.equal(simpleWrappers.length, 10);

  assert.match(
    rlsMigration,
    /assigned_user_id\s*=\s*\(select\s+auth\.uid\(\)\)/i,
  );
  assert.match(rlsMigration, /atlas\.can_read_project\(ptl\.project_id\)/i);
});

test("the RLS optimization proves semantic equivalence and preserves grants", () => {
  assert.match(rlsMigration, /expected_original_qual/);
  assert.match(rlsMigration, /rewritten_back/);
  assert.match(rlsMigration, /changed semantics beyond wrapping auth\.uid/);
  assert.match(rlsMigration, /array\['authenticated'\]::name\[\]/);
  assert.match(rlsMigration, /cmd\s*<>\s*'SELECT'/);
  assert.match(rlsMigration, /permissive\s*<>\s*'PERMISSIVE'/);
  assert.match(rlsMigration, /bell_monitoring_baselines.*directly selectable/s);

  for (const line of rlsMigration.split(/\r?\n/)) {
    assert.doesNotMatch(line, /^\s*(grant|revoke)\b/i);
    assert.doesNotMatch(line, /^\s*(create|drop)\s+policy\b/i);
    assert.doesNotMatch(line, /^\s*alter\s+table\b/i);
  }
});
