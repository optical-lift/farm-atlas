import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const portal = await readFile(new URL("../app/owner/design-atlas/RealAtlasPortal.tsx", import.meta.url), "utf8");
const workshop = await readFile(new URL("../app/owner/design-atlas/DesignWorkshop.tsx", import.meta.url), "utf8");
const clockFixture = await readFile(new URL("../app/owner/design-atlas/RealClockFixture.tsx", import.meta.url), "utf8");
const dayFixture = await readFile(new URL("../app/owner/design-atlas/RealDayWorkshopFixture.tsx", import.meta.url), "utf8");

test("Design Atlas portal inherits canonical Atlas shell and Home presentation", () => {
  assert.match(portal, /AtlasAppShell/);
  assert.match(portal, /AtlasTopBar/);
  assert.match(portal, /universal-home-v2\.module\.css/);
  assert.match(portal, /atlas-context-footer__rail/);
  assert.match(portal, /data-live-data-binding="none"/);
  assert.match(portal, /data-mutation-capability="none"/);
});

test("Design Atlas fake worker day uses the live Day visual contract", () => {
  for (const marker of [
    "atlas-day-command-header",
    "atlas-day-task-entry",
    "atlas-day-task-node",
    "atlas-day-task-card",
    "atlas-day-route-current",
    "atlas-day-route-next",
    "atlas-day-adjacent-nav",
  ]) {
    assert.ok(portal.includes(marker), `portal should preserve ${marker}`);
    assert.ok(dayFixture.includes(marker), `workshop Day should preserve ${marker}`);
  }
});

test("Design Atlas Clock specimen inherits the production Clock CSS module", () => {
  assert.match(clockFixture, /clock-surface-v2\.module\.css/);
  for (const marker of ["clockStyles.head", "clockStyles.status", "clockStyles.grid", "clockStyles.now", "clockStyles.timedTask", "clockStyles.unplacedList"]) {
    assert.ok(clockFixture.includes(marker), `Clock fixture should preserve ${marker}`);
  }
});

test("Workshop presents live-skinned Day and Clock before archived studies", () => {
  assert.match(workshop, /RealDayWorkshopFixture/);
  assert.match(workshop, /RealClockFixture/);
  assert.match(workshop, /EARLIER DESIGN STUDIES/);
});
