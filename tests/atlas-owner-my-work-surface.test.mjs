import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ownerPage = readFileSync(new URL("../app/owner/page.tsx", import.meta.url), "utf8");
const ownerDashboard = readFileSync(new URL("../app/owner/OwnerDashboardClient.tsx", import.meta.url), "utf8");
const ownerMyWork = readFileSync(new URL("../lib/atlas-data/owner-my-work.ts", import.meta.url), "utf8");

test("Owner root is driven by My Work rather than a hardcoded worker forecast", () => {
  assert.match(ownerPage, /getOwnerMyWork\(access\)/);
  assert.doesNotMatch(ownerPage, /readWorkerWeekProjection/);
  assert.doesNotMatch(ownerPage, /annaMembershipId/);
  assert.doesNotMatch(ownerPage, /23e98e5e-16ca-40d8-872c-c77e06baa167/);
});

test("Owner My Work reads direct assignment and owner-scope responsibility", () => {
  assert.match(ownerMyWork, /assigned_membership_id\.eq\.\$\{ownerMembershipId\},visibility_scope\.eq\.owner/);
  assert.match(ownerMyWork, /readAtlasPrincipalSelfContext/);
  assert.match(ownerMyWork, /principalSourceState/);
  assert.match(ownerMyWork, /\.limit\(1000\)/);
});

test("Owner surface keeps personal work first and team state secondary", () => {
  assert.match(ownerDashboard, />My Work</);
  assert.match(ownerDashboard, /Needs You Now/);
  assert.match(ownerDashboard, /title="Today"/);
  assert.match(ownerDashboard, /title="This Week"/);
  assert.match(ownerDashboard, /title="Waiting"/);
  assert.match(ownerDashboard, /title="Backlog"/);
  assert.match(ownerDashboard, /Team &amp; Operations/);
  assert.doesNotMatch(ownerDashboard, /Fallen Through the Cracks/);
  assert.doesNotMatch(ownerDashboard, /Anna's Week/);
});
