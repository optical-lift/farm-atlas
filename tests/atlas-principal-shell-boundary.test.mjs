import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const frame = await readFile(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const operationalGlobals = await readFile(new URL("../components/atlas/shell/AtlasOperationalProjectionGlobals.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const skyMaintainer = await readFile(new URL("../app/AtlasSkyLedgerMaintainer.tsx", import.meta.url), "utf8");
const bell = await readFile(new URL("../components/atlas/home/AtlasBellCover.tsx", import.meta.url), "utf8");

test("Principal projection has a small Principal dock instead of Farm Clock and Manager roots", () => {
  assert.match(frame, /pathname === "\/principal"/);
  assert.match(frame, /label: "Home", href: "\/principal"/);
  assert.match(frame, /label: "Farm Ops", href: "\/overview\/week"/);
  assert.match(frame, /principalProjection\s*\? \[/);
  assert.match(frame, /!principalProjection \? <GlobalAtlasAdd \/>/);
});

test("farm-global runtime surfaces do not mount on the Principal projection", () => {
  assert.match(operationalGlobals, /if \(isPrincipalProjection\(pathname\)\) return null/);
  assert.match(operationalGlobals, /AtlasBellCover/);
  assert.match(operationalGlobals, /GlobalDayCueDelivery/);
  assert.match(operationalGlobals, /DependencyReleaseFlash/);
  assert.match(operationalGlobals, /OwnerDayPlanGate/);
  assert.match(operationalGlobals, /AtlasWorkAlongsideOverlay/);
  assert.match(operationalGlobals, /AtlasSkyLedgerMaintainer/);
  assert.match(layout, /AtlasOperationalProjectionGlobals/);
});

test("farm Bell and Sky refresh also fail closed if mounted directly on Principal routes", () => {
  assert.match(skyMaintainer, /principalProjection/);
  assert.match(skyMaintainer, /if \(principalProjection\) return/);
  assert.match(bell, /principalProjection/);
  assert.match(bell, /if \(principalProjection\) return null/);
});
