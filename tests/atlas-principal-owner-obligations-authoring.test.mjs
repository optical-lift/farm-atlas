import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/atlas/principal/owner-obligations/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/owner/obligations/page.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../app/owner/obligations/PrincipalOwnerObligationsClient.tsx", import.meta.url), "utf8");
const principalDashboard = await readFile(new URL("../app/owner/PrincipalDashboard.tsx", import.meta.url), "utf8");

test("Owner Obligations authoring stays inside authenticated Principal authority", () => {
  assert.match(route, /getAtlasSession/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(route, /principal_self_context_api_v1/);
  assert.match(route, /principal_upsert_owner_obligation_api_v1/);
  assert.match(route, /principal-owner-obligation-v1/);
  assert.match(route, /x-atlas-intent/);
  assert.doesNotMatch(route, /atlasSupabase/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(route, /body\.principalId/);
});

test("Owner Obligation form preserves differentiated timing vocabulary", () => {
  assert.match(client, /name="becomesRelevantAt" type="datetime-local"/);
  assert.match(client, /name="mustBeginBy" type="datetime-local"/);
  assert.match(client, /name="mustFinishBy" type="datetime-local"/);
  assert.match(client, /name="fixedAt" type="datetime-local"/);
  assert.match(client, /name="expiresAt" type="datetime-local"/);
  assert.match(client, /name="preferredWindowStart" type="datetime-local"/);
  assert.match(client, /name="preferredWindowEnd" type="datetime-local"/);
  assert.match(client, /Only record a boundary when reality supplies it/);
  assert.doesNotMatch(client, /name="becomesRelevantAt"[^>]*required/);
  assert.doesNotMatch(client, /name="mustBeginBy"[^>]*required/);
  assert.doesNotMatch(client, /name="mustFinishBy"[^>]*required/);
});

test("Owner Obligation responsibility semantics are explicit rather than inferred from a due date", () => {
  assert.match(client, /name="domain" required/);
  assert.match(client, /name="expectedMinutes" type="number" min="1"/);
  assert.match(client, /name="protectionLevel" required/);
  assert.match(client, /name="floorClass" required/);
  assert.match(client, /name="ownerCapability" required/);
  assert.match(client, /name="interruptibility" required/);
  assert.match(client, /name="consequenceOfDelay"[^>]*required/);
  assert.match(client, /name="reasonForFloor"[^>]*required/);
  assert.match(route, /ownerRequired: true/);
  assert.match(route, /consequenceOfDelay/);
  assert.match(route, /reasonForFloor/);
});

test("Principal-local timestamps are converted explicitly before the database sees timestamptz values", () => {
  assert.match(route, /principalLocalToIso/);
  assert.match(route, /homeTimezone/);
  assert.match(route, /Intl\.DateTimeFormat/);
  assert.match(route, /sameLocalParts/);
  assert.match(route, /not valid in \$\{homeTimezone\}/);
  assert.match(route, /Preferred window start and end must either both be supplied or both be blank/);
  assert.match(route, /Must-finish-by cannot be before must-begin-by/);
  assert.match(route, /Expires-at cannot be before becomes-relevant-at/);
});

test("Owner Obligations can connect to portfolio horizons without requiring a farm selector", () => {
  assert.match(client, /portfolioUnitStableKey/);
  assert.match(client, /No portfolio unit/);
  assert.match(client, /H1 · current engine/);
  assert.match(client, /H2 · emerging engine/);
  assert.match(client, /H3 · future option/);
  assert.doesNotMatch(route, /farmId/);
  assert.doesNotMatch(route, /membershipId/);
});

test("Principal front door exposes the Owner Obligation authoring path", () => {
  assert.match(page, /getAtlasSession/);
  assert.match(principalDashboard, /href="\/owner\/obligations"/);
  assert.match(principalDashboard, /Author Owner Obligations/);
});
