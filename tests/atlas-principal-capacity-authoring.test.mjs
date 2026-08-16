import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/atlas/principal/capacity-policy/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/owner/capacity/page.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../app/owner/capacity/PrincipalCapacityClient.tsx", import.meta.url), "utf8");
const principalDashboard = await readFile(new URL("../app/owner/PrincipalDashboard.tsx", import.meta.url), "utf8");

test("Principal Capacity authoring uses the authenticated Principal RPC and explicit intent", () => {
  assert.match(route, /getAtlasSession/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(route, /principal_set_capacity_policy_api_v1/);
  assert.match(route, /principal-capacity-policy-v1/);
  assert.match(route, /x-atlas-intent/);
  assert.doesNotMatch(route, /atlasSupabase/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("capacity policy reads stay Principal-scoped and do not accept a caller-supplied Principal id", () => {
  assert.match(route, /current_principal_id_v1/);
  assert.match(route, /principal_capacity_policies/);
  assert.match(route, /\.eq\("principal_id", principalRead\.data\)/);
  assert.doesNotMatch(route, /body\.principalId/);
  assert.doesNotMatch(route, /p_principal_id/);
});

test("capacity authoring validates the database contract before writing", () => {
  assert.match(route, /Choose at least one weekday/);
  assert.match(route, /localEnd <= localStart/);
  assert.match(route, /Maximum planned minutes must be at least the discretionary minutes/);
  assert.match(route, /Effective-through cannot be before effective-from/);
  assert.match(route, /effectiveFrom/);
  assert.match(route, /effectiveThrough/);
});

test("Principal Capacity form begins unanchored instead of guessing the Principal's schedule", () => {
  assert.match(page, /getAtlasSession/);
  assert.match(client, /useState<number\[]>\(\[\]\)/);
  assert.match(client, /No days selected yet/);
  assert.match(client, /name="localStart" type="time" required/);
  assert.match(client, /name="localEnd" type="time" required/);
  assert.match(client, /name="defaultDiscretionaryMinutes" type="number"/);
  assert.match(client, /name="maximumPlannedMinutes" type="number"/);
  assert.match(client, /name="effectiveFrom" type="date" required/);
  assert.doesNotMatch(client, /defaultValue=/);
  assert.doesNotMatch(client, /checked=\{true\}/);
});

test("Principal front door offers the authoring path when capacity needs an anchor", () => {
  assert.match(principalDashboard, /href="\/owner\/capacity"/);
  assert.match(principalDashboard, /Establish Principal Capacity/);
  assert.match(principalDashboard, /Review capacity policies/);
});
