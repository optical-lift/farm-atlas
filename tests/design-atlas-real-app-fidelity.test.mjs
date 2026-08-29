import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const portal = await readFile(new URL("../app/owner/design-atlas/CanonicalAtlasPortal.tsx", import.meta.url), "utf8");
const homeFixture = await readFile(new URL("../app/owner/design-atlas/DesignAtlasCanonicalHome.tsx", import.meta.url), "utf8");
const workshop = await readFile(new URL("../app/owner/design-atlas/DesignWorkshop.tsx", import.meta.url), "utf8");
const clockFixture = await readFile(new URL("../app/owner/design-atlas/RealClockFixture.tsx", import.meta.url), "utf8");
const dayFixture = await readFile(new URL("../app/owner/design-atlas/RealDayWorkshopFixture.tsx", import.meta.url), "utf8");
const dock = await readFile(new URL("../components/atlas/shell/AtlasDock.tsx", import.meta.url), "utf8");
const moreList = await readFile(new URL("../components/atlas/shell/AtlasMoreDestinationList.tsx", import.meta.url), "utf8");
const home = await readFile(new URL("../components/atlas/home/AtlasUniversalHomeV2.tsx", import.meta.url), "utf8");

test("Design Atlas portal mounts canonical Atlas shell, Home, dock, and More components", () => {
  assert.match(portal, /AtlasAppShell/);
  assert.match(portal, /AtlasTopBar/);
  assert.match(portal, /<AtlasDock/);
  assert.match(portal, /AtlasMoreDestinationList/);
  assert.match(portal, /DesignAtlasCanonicalHome/);
  assert.match(homeFixture, /<AtlasUniversalHomeV2/);
  assert.match(homeFixture, /fixtureOnly/);
  assert.match(home, /data-atlas-home-data-mode=\{fixtureOnly \? "fixture" : "live"\}/);
  assert.match(dock, /atlas-context-footer__rail/);
  assert.match(moreList, /atlas-more-page__list/);
  assert.match(portal, /data-live-data-binding="none"/);
  assert.match(portal, /data-mutation-capability="none"/);
});

test("Design Atlas uses the actual chosen app dock destinations rather than invented permanent tabs", () => {
  for (const label of ["Home", "Work", "Clock", "Harvest", "More"]) assert.ok(portal.includes(`label: "${label}"`));
  assert.ok(portal.includes('label: "Manager"'));
  assert.doesNotMatch(portal, /label:\s*"Workspaces"/);
  assert.doesNotMatch(portal, /label:\s*"Calendar"/);
});

test("Design Atlas fake worker day uses the live Day visual contract until the route card is extracted", () => {
  assert.match(portal, /RealDayWorkshopFixture/);
  for (const marker of [
    "atlas-day-command-header",
    "atlas-day-task-entry",
    "atlas-day-task-node",
    "atlas-day-task-card",
    "atlas-day-route-current",
    "atlas-day-route-next",
    "atlas-day-adjacent-nav",
  ]) {
    assert.ok(dayFixture.includes(marker), `workshop Day should preserve ${marker}`);
  }
});

test("Design Atlas Clock specimen mounts the production Clock components instead of redrawing them", () => {
  assert.match(clockFixture, /ClockHeaderV2/);
  assert.match(clockFixture, /ClockTimelineV2/);
  assert.match(clockFixture, /ClockUnplacedV2/);
  assert.doesNotMatch(clockFixture, /clock-surface-v2\.module\.css/);
  assert.match(clockFixture, /canManage=\{false\}/);
  assert.match(clockFixture, /data-live-data-binding="none"/);
  assert.match(clockFixture, /data-mutation-capability="none"/);
});

test("Workshop presents live-skinned Day and canonical Clock before archived studies", () => {
  assert.match(workshop, /RealDayWorkshopFixture/);
  assert.match(workshop, /RealClockFixture/);
  assert.match(workshop, /EARLIER DESIGN STUDIES/);
});
