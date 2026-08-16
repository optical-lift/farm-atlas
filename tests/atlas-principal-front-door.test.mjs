import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ownerPage = await readFile(new URL("../app/owner/page.tsx", import.meta.url), "utf8");
const principalDashboard = await readFile(new URL("../app/owner/PrincipalDashboard.tsx", import.meta.url), "utf8");
const principalContextReader = await readFile(new URL("../lib/atlas-data/principal-context.ts", import.meta.url), "utf8");

test("Owner root is Principal context rather than a selected-farm task dashboard", () => {
  assert.match(ownerPage, /readPrincipalSelfContext/);
  assert.match(ownerPage, /getAtlasSession/);
  assert.match(ownerPage, /PrincipalDashboard/);
  assert.doesNotMatch(ownerPage, /getOwnerDashboard/);
  assert.doesNotMatch(ownerPage, /readOwnerWeekProjection/);
  assert.doesNotMatch(ownerPage, /readOwnerFinishProjectSummary/);
  assert.doesNotMatch(ownerPage, /23e98e5e-16ca-40d8-872c-c77e06baa167/);
});

test("Principal context is read through the authenticated session client", () => {
  assert.match(principalContextReader, /createAtlasServerClient/);
  assert.match(principalContextReader, /principal_self_context_api_v1/);
  assert.doesNotMatch(principalContextReader, /atlasSupabase/);
  assert.doesNotMatch(principalContextReader, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("Principal front door exposes arbitration, capacity, portfolio, household, and Office truth", () => {
  assert.match(principalDashboard, /Who has earned the floor\?/);
  assert.match(principalDashboard, /Principal Capacity/);
  assert.match(principalDashboard, /Feast Guild \/ Portfolio/);
  assert.match(principalDashboard, /H1 · H2 · H3/);
  assert.match(principalDashboard, /Household & Family/);
  assert.match(principalDashboard, /Protected domain/);
  assert.match(principalDashboard, /Principal Office/);
  assert.match(principalDashboard, /House Position/);
  assert.match(principalDashboard, /source_required/);
  assert.match(principalDashboard, /Delegated farm work stays in the operating layer unless it crosses an escalation contract/);
});

test("Principal root keeps farm execution available below it without making farm work the root", () => {
  assert.match(principalDashboard, /href="\/overview\/week"/);
  assert.match(principalDashboard, /Farm Execution/);
  assert.match(principalDashboard, /href="\/projects"/);
  assert.doesNotMatch(principalDashboard, /Anna's Week/);
  assert.doesNotMatch(principalDashboard, /Fallen Through the Cracks/);
  assert.doesNotMatch(principalDashboard, /dashboard\.farm\.name/);
});
