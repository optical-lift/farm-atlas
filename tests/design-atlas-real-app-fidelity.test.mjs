import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const portal = await readFile(new URL("../app/owner/design-atlas/CanonicalAtlasPortal.tsx", import.meta.url), "utf8");
const homeFixture = await readFile(new URL("../app/owner/design-atlas/DesignAtlasCanonicalHome.tsx", import.meta.url), "utf8");
const principalFixture = await readFile(new URL("../app/owner/design-atlas/DesignAtlasPrincipal.tsx", import.meta.url), "utf8");
const managerFixture = await readFile(new URL("../app/owner/design-atlas/DesignAtlasManagerDay.tsx", import.meta.url), "utf8");
const workshop = await readFile(new URL("../app/owner/design-atlas/DesignWorkshop.tsx", import.meta.url), "utf8");
const clockFixture = await readFile(new URL("../app/owner/design-atlas/RealClockFixture.tsx", import.meta.url), "utf8");
const futureClock = await readFile(new URL("../app/owner/design-atlas/FutureClockFixture.tsx", import.meta.url), "utf8");
const dayFixture = await readFile(new URL("../app/owner/design-atlas/RealDayWorkshopFixture.tsx", import.meta.url), "utf8");
const dock = await readFile(new URL("../components/atlas/shell/AtlasDock.tsx", import.meta.url), "utf8");
const moreList = await readFile(new URL("../components/atlas/shell/AtlasMoreDestinationList.tsx", import.meta.url), "utf8");
const home = await readFile(new URL("../components/atlas/home/AtlasUniversalHomeV2.tsx", import.meta.url), "utf8");
const principal = await readFile(new URL("../components/atlas/principal/PrincipalSurface.tsx", import.meta.url), "utf8");
const manager = await readFile(new URL("../components/atlas/manage/ManagerDaySurface.tsx", import.meta.url), "utf8");
const harvest = await readFile(new URL("../app/harvest/HarvestedOutputSection.tsx", import.meta.url), "utf8");

test("Design Atlas mounts shared shell, Home, Principal, Manager, dock, More, and Harvest presentation", () => {
  assert.match(portal, /AtlasAppShell/);
  assert.match(portal, /AtlasTopBar/);
  assert.match(portal, /<AtlasDock/);
  assert.match(portal, /AtlasMoreDestinationList/);
  assert.match(portal, /DesignAtlasCanonicalHome/);
  assert.match(portal, /DesignAtlasPrincipal/);
  assert.match(portal, /DesignAtlasManagerDay/);
  assert.match(homeFixture, /<AtlasUniversalHomeV2/);
  assert.match(principalFixture, /<PrincipalSurface/);
  assert.match(managerFixture, /<ManagerDaySurface/);
  assert.match(homeFixture, /fixtureOnly/);
  assert.match(principalFixture, /fixtureOnly/);
  assert.match(managerFixture, /fixtureOnly/);
  assert.match(home, /data-atlas-home-data-mode=\{fixtureOnly \? "fixture" : "live"\}/);
  assert.match(principal, /data-atlas-principal-mode=\{fixtureOnly \? "fixture" : "live"\}/);
  assert.match(manager, /data-atlas-manager-day-mode=\{fixtureOnly \? "fixture" : "live"\}/);
  assert.match(harvest, /fixtureOnly/);
  assert.match(dock, /atlas-context-footer__rail/);
  assert.match(moreList, /atlas-more-page__list/);
  assert.match(portal, /data-live-data-binding="none"/);
  assert.match(portal, /data-mutation-capability="none"/);
});

test("Design Atlas uses actual role-specific dock destinations and removes invented permanent tabs", () => {
  for (const label of ["Home", "Work", "Clock", "Harvest", "More", "Farm Ops"]) assert.ok(portal.includes(`label: "${label}"`));
  assert.match(portal, /persona === "principal"[\s\S]*label: "Home"[\s\S]*label: "Farm Ops"[\s\S]*label: "More"/);
  assert.doesNotMatch(portal, /label:\s*"Workspaces"/);
  assert.doesNotMatch(portal, /label:\s*"Calendar"/);
});

test("Design Atlas fake worker day uses the live Day visual contract until the route card is extracted", () => {
  assert.match(portal, /RealDayWorkshopFixture/);
  for (const marker of ["atlas-day-command-header", "atlas-day-task-entry", "atlas-day-task-node", "atlas-day-task-card", "atlas-day-route-current", "atlas-day-route-next", "atlas-day-adjacent-nav"]) assert.ok(dayFixture.includes(marker), `workshop Day should preserve ${marker}`);
});

test("current Clock reference mounts production components instead of redrawing them", () => {
  assert.match(clockFixture, /ClockHeaderV2/);
  assert.match(clockFixture, /ClockTimelineV2/);
  assert.match(clockFixture, /ClockUnplacedV2/);
  assert.doesNotMatch(clockFixture, /clock-surface-v2\.module\.css/);
  assert.match(clockFixture, /canManage=\{false\}/);
  assert.match(clockFixture, /data-live-data-binding="none"/);
  assert.match(clockFixture, /data-mutation-capability="none"/);
});

test("Design Atlas preserves the governed future Farm Clock separately from shipped Clock", () => {
  assert.match(portal, /<FutureClockFixture/);
  assert.match(workshop, /<FutureClockFixture/);
  assert.match(workshop, /CURRENT PRODUCTION CLOCK/);
  assert.match(futureClock, /data-atlas-future-clock="dropbox-governed-v1"/);
  assert.match(futureClock, />NOW</);
  assert.match(futureClock, />NEXT</);
  assert.match(futureClock, /Occupied Time|OCCUPIED TIME/);
  assert.match(futureClock, /READ FIRST/);
  assert.match(futureClock, /CHANGED — READ AGAIN/);
  assert.match(futureClock, /UNLOCKS/);
  assert.match(futureClock, /CARRY/);
  assert.match(futureClock, /RESCHEDULE/);
  assert.match(futureClock, /EXPIRE/);
  assert.match(futureClock, /NEEDS MANAGEMENT/);
  assert.match(futureClock, /data-live-data-binding="none"/);
  assert.match(futureClock, /data-mutation-capability="none"/);
});

test("Design Atlas Harvest uses a canonical destination component, not a Harvest task-card substitute", () => {
  assert.match(portal, /<HarvestedOutputSection fixtureOnly fixtureData=\{HARVEST_FIXTURE\}/);
  assert.match(harvest, /data-atlas-harvested|atlas-harvested/);
  assert.doesNotMatch(portal, /HarvestCardSpecimen/);
});

test("Workshop presents governed future Clock, current production Clock, and earlier studies in that order", () => {
  assert.match(workshop, /RealDayWorkshopFixture/);
  const futureIndex = workshop.indexOf("<FutureClockFixture");
  const currentIndex = workshop.indexOf("<RealClockFixture");
  const archiveIndex = workshop.indexOf("EARLIER DESIGN STUDIES");
  assert.ok(futureIndex >= 0 && currentIndex > futureIndex && archiveIndex > currentIndex);
});
