import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const principalPage = await readFile(new URL("../app/principal/page.tsx", import.meta.url), "utf8");
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
});

test("Principal page projects Clock, capacity, portfolio, attention, and House Position truth", () => {
  assert.match(principalPage, /Principal Clock/);
  assert.match(principalPage, /Principal Capacity/);
  assert.match(principalPage, /Feast Guild \/ Portfolio/);
  assert.match(principalPage, /Quiet responsibilities/);
  assert.match(principalPage, /House Position/);
  assert.match(principalPage, /source_required/);
  assert.match(principalPage, /No claim has earned the floor/);
  assert.match(principalPage, /No farm required/);
  assert.doesNotMatch(principalPage, /preferredFarmId/);
  assert.doesNotMatch(principalPage, /selectedFarm/);
});
