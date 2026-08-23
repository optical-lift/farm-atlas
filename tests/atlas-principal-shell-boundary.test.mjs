import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const frame = await readFile(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const operationalGlobals = await readFile(new URL("../components/atlas/shell/AtlasOperationalProjectionGlobals.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const skyMaintainer = await readFile(new URL("../app/AtlasSkyLedgerMaintainer.tsx", import.meta.url), "utf8");
const bell = await readFile(new URL("../components/atlas/home/AtlasBellCover.tsx", import.meta.url), "utf8");

test("Principal projection keeps its runtime boundary without creating a second Owner navigation universe", () => {
  assert.match(frame, /pathname === "\/principal"/);
  assert.match(frame, /ownerMode \? "\/principal" : "\/"/);
  assert.match(frame, /ownerMode \? "\/owner" : workHref/);
  assert.doesNotMatch(frame, /label: "Farm Ops", href: "\/overview\/week"/);
  assert.doesNotMatch(frame, /principalProjection\s*\? \[/);
  assert.match(frame, /label: "Clock"/);
  assert.match(frame, /label: "Manager"/);
  assert.match(frame, /label: "Harvest"/);
  assert.match(frame, /label: "More"/);
});

test("the global Atlas add control is retired from the contextual shell", () => {
  assert.doesNotMatch(frame, /GlobalAtlasAdd/);
  assert.doesNotMatch(frame, /Add to Atlas/);
});

test("farm-global runtime surfaces do not mount on the Principal projection and paused Bell does not mount anywhere", () => {
  assert.match(operationalGlobals, /if \(isPrincipalProjection\(pathname\)\) return null/);
  assert.doesNotMatch(operationalGlobals, /AtlasBellCover/);
  assert.match(operationalGlobals, /GlobalDayCueDelivery/);
  assert.match(operationalGlobals, /DependencyReleaseFlash/);
  assert.match(operationalGlobals, /OwnerDayPlanGate/);
  assert.match(operationalGlobals, /AtlasWorkAlongsideOverlay/);
  assert.match(operationalGlobals, /AtlasSkyLedgerMaintainer/);
  assert.match(layout, /AtlasOperationalProjectionGlobals/);
});

test("farm Bell and Sky retain their direct Principal fail-closed guards for later restoration", () => {
  assert.match(skyMaintainer, /principalProjection/);
  assert.match(skyMaintainer, /if \(principalProjection\) return/);
  assert.match(bell, /principalProjection/);
  assert.match(bell, /if \(principalProjection\) return null/);
});
