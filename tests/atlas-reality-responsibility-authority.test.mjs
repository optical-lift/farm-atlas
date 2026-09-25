import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const session = read("lib/atlas/session.ts");
const core = read("lib/atlas/session-core.js");
const identityPage = read("app/principal/resolve/entity-identity/page.tsx");
const identityRoute = read("app/api/atlas/entity-identity-review/route.ts");
const identityReader = read("lib/atlas/entity-identity-review.ts");
const capacityPage = read("app/principal/resolve/farm-capacity/page.tsx");
const capacityRoute = read("app/api/atlas/principal/worker-day-shape/route.ts");
const legacyOwnerRoute = read("app/api/atlas/owner-worker-day-shape/route.ts");

test("session projects explicit Reality responsibilities separately from seats and farm execution scope", () => {
  assert.match(session, /AtlasSessionResponsibility/);
  assert.match(session, /responsibilities: AtlasSessionResponsibility\[\]/);
  assert.match(session, /atlasSessionHasResponsibility/);
  assert.match(core, /normalizeResponsibilities/);
  assert.doesNotMatch(session, /organizationMemberships.*responsibility/);
});

test("identity review admission and mutation use exact responsibility operations", () => {
  assert.match(identityPage, /reality_identity_adjudication/);
  assert.match(identityPage, /identity_review\.read/);
  assert.match(identityRoute, /reality_identity_adjudication/);
  assert.match(identityRoute, /identity_review\.adjudicate/);
  assert.match(identityReader, /entity_identity_review_queue_api_v2/);
  assert.match(identityRoute, /entity_identity_adjudicate_api_v2/);
  assert.doesNotMatch(identityPage, /role === "owner"/);
  assert.doesNotMatch(identityRoute, /role === "owner"/);
});

test("capacity exception admission and mutation use institutional worker-capacity responsibility", () => {
  assert.match(capacityPage, /institutional_worker_capacity_truth/);
  assert.match(capacityPage, /worker_day_shape\.read_exception/);
  assert.match(capacityRoute, /institutional_worker_capacity_truth/);
  assert.match(capacityRoute, /worker_day_shape\.author/);
  assert.match(capacityRoute, /institutional_worker_day_shape_set_self_api_v1/);
  assert.doesNotMatch(capacityPage, /organizationMemberships\.some/);
  assert.doesNotMatch(capacityRoute, /owner_set_worker_day_shape_api_v1/);
});

test("legacy owner Day Shape surface remains explicitly compatibility-only", () => {
  assert.match(legacyOwnerRoute, /owner_set_worker_day_shape_api_v1/);
});
