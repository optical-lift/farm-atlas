import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const route = read("app/api/atlas/principal/capacity-authoring/route.ts");
const reader = read("lib/atlas/principal-capacity-policy.ts");
const page = read("app/principal/author/capacity/page.tsx");
const client = read("app/principal/author/capacity/PrincipalCapacityAuthoringClient.tsx");

test("personal capacity surface requires canonical personal identity, not owner authority", () => {
  assert.match(route, /requirePersonalAtlas/);
  assert.match(route, /session\.realityState !== "ready"/);
  assert.match(route, /session\.personEntityId/);
  assert.match(route, /session\.personalAtlasId/);
  assert.doesNotMatch(route, /organizationMemberships\.some/);
  assert.doesNotMatch(route, /role === "owner"/);
  assert.doesNotMatch(route, /principal_owner_required/);
});

test("personal capacity and household authoring use the Reality-rooted self RPCs", () => {
  assert.match(reader, /personal_capacity_policies_self_api_v1/);
  assert.match(route, /personal_set_capacity_policy_self_api_v1/);
  assert.match(route, /personal_upsert_household_rhythm_local_self_api_v1/);
  assert.doesNotMatch(reader, /principal_capacity_policies_self_api_v1/);
  assert.doesNotMatch(route, /principal_set_capacity_policy_api_v1/);
  assert.doesNotMatch(route, /principal_upsert_household_rhythm_local_api_v1/);
});

test("capacity authoring copy no longer presents Organization ownership as the personal-state source", () => {
  assert.match(page, /Personal Capacity/);
  assert.match(client, /Personal Capacity/);
  assert.match(client, /personal capacity/i);
});
