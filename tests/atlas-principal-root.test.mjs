import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const principalPage = await readFile(new URL("../app/principal/page.tsx", import.meta.url), "utf8");
const principalSurface = await readFile(new URL("../components/atlas/principal/PrincipalSurface.tsx", import.meta.url), "utf8");
const principalUi = `${principalPage}\n${principalSurface}`;
const principalReader = await readFile(new URL("../lib/atlas/principal-self-context.ts", import.meta.url), "utf8");

test("Principal sessions leave the farm-root home before a farm is selected", () => {
  assert.match(home, /principalOrganizationMembership\?\.role === "owner"/);
  assert.match(home, /!operatorContext\?\.isOperating/);
  assert.match(home, /redirect\("\/principal"\)/);

  const principalRedirect = home.indexOf('redirect("/principal")');
  const selectedFarm = home.indexOf("const selectedFarmKey");
  const farmHomeRead = home.indexOf("readAtlasOperatorUniversalHome(viewer");
  assert.ok(principalRedirect >= 0);
  assert.ok(selectedFarm > principalRedirect);
  assert.ok(farmHomeRead > principalRedirect);
});

test("explicit Farm Hand operating mode remains on Worker execution home", () => {
  assert.match(home, /operatorContext\?\.isOperating && operatorContext\.effective\.farmRole === "farm_hand"/);
  assert.match(home, /getWorkerDayRoutingState/);
  assert.match(home, /atlasFarmHandConveyorMoves/);
  assert.match(home, /farmHandMode=\{renderedFarmHandMode\}/);
});

test("Principal root reads one authenticated whole-field context without a farm parameter", () => {
  assert.match(principalReader, /createAtlasServerClient/);
  assert.match(principalReader, /rpc\("principal_self_context_api_v1"\)/);
  assert.doesNotMatch(principalReader, /atlasSupabase/);
  assert.doesNotMatch(principalReader, /SUPABASE_SERVICE_ROLE/);
  assert.doesNotMatch(principalReader, /farmId:/);
  assert.match(principalPage, /<PrincipalSurface context=\{context\}/);
});

test("Principal page projects Clock, capacity, portfolio, attention, and House Position truth", () => {
  assert.match(principalUi, /Principal Clock/);
  assert.match(principalUi, /Principal Capacity/);
  assert.match(principalUi, /Feast Guild \/ Portfolio/);
  assert.match(principalUi, /Quiet responsibilities/);
  assert.match(principalUi, /House Position/);
  assert.match(principalUi, /source_required/);
  assert.match(principalUi, /No claim has earned the floor/);
  assert.match(principalUi, /No farm required/);
  assert.doesNotMatch(principalPage, /preferredFarmId/);
  assert.doesNotMatch(principalPage, /selectedFarm/);
});
