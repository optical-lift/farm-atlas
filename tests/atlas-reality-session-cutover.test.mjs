import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const session = read("lib/atlas/session.ts");
const principal = read("app/principal/page.tsx");
const home = read("app/page.tsx");
const operatorContext = read("lib/atlas/operator-context.ts");
const identityPage = read("app/principal/resolve/entity-identity/page.tsx");
const identityRoute = read("app/api/atlas/entity-identity-review/route.ts");
const identityReader = read("lib/atlas/entity-identity-review.ts");
const capacityPage = read("app/principal/resolve/farm-capacity/page.tsx");
const capacityRoute = read("app/api/atlas/principal/worker-day-shape/route.ts");

test("root authenticated reads no longer query organization membership identity", () => {
  assert.doesNotMatch(session, /from\("organization_memberships"\)/);
  assert.match(session, /current_session_context_api_v2/);
});

test("Principal read access is rooted in Personal Atlas instead of organization owner role", () => {
  assert.match(principal, /session\.personEntityId/);
  assert.match(principal, /session\.personalAtlasId/);
  assert.doesNotMatch(principal, /organizationMemberships\.some/);
});

test("legacy farm owner remains only a projection compatibility choice on Home", () => {
  assert.match(home, /principalFarmMembership/);
  assert.match(home, /membership\.role === "owner"/);
  assert.match(home, /session\.personalAtlasId/);
  assert.doesNotMatch(home, /principalOrganizationMembership\?\.role === "owner"/);
});

test("operator switching no longer treats organization owner role as root session authority", () => {
  assert.match(operatorContext, /session\.memberships\.some/);
  assert.doesNotMatch(operatorContext, /session\.organizationMemberships\.some\(\(membership\) => membership\.role === "owner"\)/);
});


test("Reality responsibility replaces the last Principal identity-adjudication owner gate", () => {
  assert.match(identityPage, /reality_identity_adjudication/);
  assert.match(identityPage, /identity_review\.read/);
  assert.doesNotMatch(identityPage, /organizationMemberships\.some/);
  assert.match(identityRoute, /identity_review\.adjudicate/);
  assert.match(identityRoute, /entity_identity_adjudicate_api_v2/);
  assert.doesNotMatch(identityRoute, /organizationMemberships\.some/);
  assert.match(identityReader, /entity_identity_review_queue_api_v2/);
});

test("Reality responsibility replaces the Principal farm-capacity owner gate", () => {
  assert.match(capacityPage, /institutional_worker_capacity_truth/);
  assert.match(capacityPage, /worker_day_shape\.read_exception/);
  assert.doesNotMatch(capacityPage, /organizationMemberships\.some/);
  assert.match(capacityRoute, /institutional_worker_capacity_truth/);
  assert.match(capacityRoute, /worker_day_shape\.author/);
  assert.match(capacityRoute, /institutional_worker_day_shape_set_self_api_v1/);
  assert.doesNotMatch(capacityRoute, /owner_set_worker_day_shape_api_v1/);
  assert.doesNotMatch(capacityRoute, /organizationMemberships\.some/);
});
