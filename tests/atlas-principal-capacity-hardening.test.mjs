import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260817005940_principal_capacity_policy_window_invariant_v2.sql");
const route = read("app/api/atlas/principal/capacity-authoring/route.ts");
const reader = read("lib/atlas/principal-capacity-policy.ts");
const page = read("app/principal/author/capacity/page.tsx");
const client = read("app/principal/author/capacity/PrincipalCapacityAuthoringClient.tsx");

test("Principal capacity RPC enforces the day envelope, not only browser/API validation", () => {
  assert.match(migration, /v_window_minutes/);
  assert.match(migration, /maximumPlannedMinutes cannot exceed the local capacity window itself/);
  assert.match(migration, /defaultDiscretionaryMinutes cannot exceed maximumPlannedMinutes/);
  assert.match(migration, /localEnd must be later than localStart/);
  assert.match(migration, /set search_path = pg_catalog, atlas, auth/);
  assert.match(route, /Maximum planned minutes cannot exceed the local capacity window itself/);
});

test("authored Principal capacity is read through the governed self RPC", () => {
  assert.match(reader, /createAtlasServerClient/);
  assert.match(reader, /principal_capacity_policies_self_api_v1/);
  assert.doesNotMatch(reader, /atlasSupabase|SERVICE_ROLE|service_role/);
  assert.doesNotMatch(reader, /\.from\("principal_capacity_policies"\)/);
  assert.match(page, /readAtlasPrincipalCapacityPolicies/);
  assert.match(page, /const currentPolicy = capacityPolicies\[0\] \?\? null/);
});

test("capacity edits retain the authored stable key and reload authored values", () => {
  assert.match(client, /name="stableKey" defaultValue=\{currentPolicy\?\.stableKey \?\? ""\}/);
  assert.match(client, /stableKey: optionalText\(data, "stableKey"\)/);
  assert.match(client, /defaultChecked=\{currentPolicy\?\.weekdays\.includes\(value\) \?\? false\}/);
  assert.match(client, /defaultValue=\{currentPolicy\?\.localStart \?\? ""\}/);
  assert.match(client, /defaultValue=\{currentPolicy\?\.localEnd \?\? ""\}/);
  assert.match(client, /defaultValue=\{currentPolicy\?\.defaultDiscretionaryMinutes \?\? ""\}/);
  assert.match(client, /defaultValue=\{currentPolicy\?\.maximumPlannedMinutes \?\? ""\}/);
  assert.match(client, /defaultValue=\{currentPolicy\?\.effectiveFrom \?\? ""\}/);
  assert.match(client, /Update Capacity Policy/);
});

test("first-time capacity authoring still has no inferred weekdays, hours, or minutes", () => {
  assert.doesNotMatch(client, /defaultChecked=\{true\}[^\n]*name="weekdays"/);
  assert.doesNotMatch(client, /name="localStart"[^\n]*defaultValue="\d{2}:\d{2}"/);
  assert.doesNotMatch(client, /name="localEnd"[^\n]*defaultValue="\d{2}:\d{2}"/);
  assert.doesNotMatch(client, /name="defaultDiscretionaryMinutes"[^\n]*defaultValue=\{?\d+/);
  assert.doesNotMatch(client, /name="maximumPlannedMinutes"[^\n]*defaultValue=\{?\d+/);
  assert.match(client, /This is not a productivity target/);
});
