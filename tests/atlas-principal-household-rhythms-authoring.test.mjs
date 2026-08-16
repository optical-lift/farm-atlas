import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/atlas/principal/household-rhythms/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/owner/household/page.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../app/owner/household/PrincipalHouseholdRhythmsClient.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../app/owner/PrincipalDashboard.tsx", import.meta.url), "utf8");

test("Household rhythm authoring stays authenticated and Principal-household scoped", () => {
  assert.match(route, /getAtlasSession/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(route, /principal_self_context_api_v1/);
  assert.match(route, /principal_upsert_household_rhythm_api_v1/);
  assert.match(route, /principal-household-rhythm-v1/);
  assert.match(route, /x-atlas-intent/);
  assert.doesNotMatch(route, /atlasSupabase/);
  assert.doesNotMatch(route, /farmId/);
  assert.doesNotMatch(route, /membershipId/);
});

test("capacity blocking and Principal Clock candidacy are separately authored", () => {
  assert.match(client, /name="blocksCapacity" type="checkbox"/);
  assert.match(client, /name="principalRequired" type="checkbox"/);
  assert.match(client, /This does not make it farm work/);
  assert.match(client, /This is what allows the rhythm to become a Principal Clock candidate/);
  assert.match(route, /const principalRequired = booleanValue\(body\.principalRequired\)/);
  assert.match(route, /const blocksCapacity = booleanValue\(body\.blocksCapacity\)/);
  assert.match(route, /principalRequired,/);
  assert.match(route, /blocksCapacity,/);
  assert.doesNotMatch(client, /name="blocksCapacity"[^>]*checked/);
  assert.doesNotMatch(client, /name="principalRequired"[^>]*checked/);
});

test("Household rhythm next window is explicit Principal-local truth", () => {
  assert.match(client, /name="nextWindowStart" type="datetime-local"/);
  assert.match(client, /name="nextWindowEnd" type="datetime-local"/);
  assert.match(client, /Only an actual recorded start \+ end can subtract time from current Principal Capacity/);
  assert.doesNotMatch(client, /type="datetime-local"[^>]*defaultValue/);
  assert.match(route, /principalLocalToIso/);
  assert.match(route, /homeTimezone/);
  assert.match(route, /Next window start and end must either both be supplied or both be blank/);
  assert.match(route, /Next Household window end must be after its start/);
});

test("cadence prose is not mistaken for an execution scheduler", () => {
  assert.match(client, /Cadence rule \/ pattern/);
  assert.match(client, /Optional descriptive pattern/);
  assert.match(client, /recorded next window below is what can currently block capacity/);
  assert.match(route, /cadenceRule: cadenceRule \|\| null/);
  assert.doesNotMatch(route, /create.*task/i);
  assert.doesNotMatch(route, /insert.*tasks/i);
});

test("Household rhythms carry explicit protection semantics without becoming farm work", () => {
  assert.match(client, /name="expectedMinutes" type="number" min="1"/);
  assert.match(client, /name="protectionLevel" required/);
  assert.match(client, /name="floorClass" required/);
  assert.match(client, /name="interruptibility" required/);
  assert.match(client, /name="reasonForFloor"[^>]*required/);
  assert.match(client, /Recorded Household rhythms/);
  assert.match(client, /Not farm tasks/);
});

test("Principal front door exposes Household rhythm authoring", () => {
  assert.match(page, /getAtlasSession/);
  assert.match(dashboard, /href="\/owner\/household"/);
  assert.match(dashboard, /Author Household rhythms/);
});
