import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const portal = await readFile(new URL("../app/owner/design-atlas/CanonicalAtlasPortal.tsx", import.meta.url), "utf8");
const roleSurfaces = await readFile(new URL("../app/owner/design-atlas/DesignAtlasRoleSurfaces.tsx", import.meta.url), "utf8");
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
const workerClock = await readFile(new URL("../components/atlas/clock/worker-clock-surface.tsx", import.meta.url), "utf8");
const clockOrchestrator = await readFile(new URL("../components/atlas/clock/clock-orchestrator.tsx", import.meta.url), "utf8");
const harvest = await readFile(new URL("../app/harvest/HarvestedOutputSection.tsx", import.meta.url), "utf8");

test("Design Atlas mounts shared shell, canonical Home/Principal surfaces, and role-aware assembly", () => {
  assert.match(portal, /AtlasAppShell/);
  assert.match(portal, /AtlasTopBar/);
  assert.match(portal, /<AtlasDock/);
  assert.match(portal, /AtlasMoreDestinationList/);
  assert.match(portal, /DesignAtlasCanonicalHome/);
  assert.match(portal, /DesignAtlasPrincipal/);
  assert.match(portal, /DesignAtlasManagerDay/);
  assert.match(portal, /DesignAtlasRoleSurfaces/);
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

test("Design Atlas dock expresses one product with job-specific destinations", () => {
  for (const label of ["Home", "Work", "Clock", "Harvest", "More", "Farm Ops", "Buyer Desk"]) assert.ok(portal.includes(`label: "${label}"`));
  assert.match(portal, /persona === "principal"[\s\S]*label: "Home"[\s\S]*label: "Farm Ops"[\s\S]*label: "More"/);
  assert.match(portal, /persona === "katie"[\s\S]*label: "Home"[\s\S]*label: "Buyer Desk"[\s\S]*label: "More"/);
  assert.match(portal, /persona === "marshall"[\s\S]*label: "Home"[\s\S]*label: "Work"[\s\S]*label: "Clock"[\s\S]*label: "More"/);
  assert.doesNotMatch(portal, /label:\s*"Workspaces"/);
  assert.doesNotMatch(portal, /label:\s*"Calendar"/);
});

test("Design Atlas fake worker Day keeps one visual contract while changing work by role", () => {
  assert.match(portal, /RealDayWorkshopFixture persona=\{persona\}/);
  assert.match(dayFixture, /type WorkerPersona = "anna" \| "marshall"/);
  assert.match(dayFixture, /ANNA_TASKS/);
  assert.match(dayFixture, /MARSHALL_TASKS/);
  assert.match(dayFixture, /data-atlas-day-persona=\{persona\}/);
  for (const marker of ["atlas-day-command-header", "atlas-day-task-entry", "atlas-day-task-node", "atlas-day-task-card", "atlas-day-route-current", "atlas-day-route-next", "atlas-day-adjacent-nav"]) assert.ok(dayFixture.includes(marker), `workshop Day should preserve ${marker}`);
});

test("legacy Clock reference still mounts the old production components without pretending to be current", () => {
  assert.match(clockFixture, /ClockHeaderV2/);
  assert.match(clockFixture, /ClockTimelineV2/);
  assert.match(clockFixture, /ClockUnplacedV2/);
  assert.doesNotMatch(clockFixture, /clock-surface-v2\.module\.css/);
  assert.match(clockFixture, /canManage=\{false\}/);
  assert.match(clockFixture, /data-live-data-binding="none"/);
  assert.match(clockFixture, /data-mutation-capability="none"/);
  assert.match(workshop, /LEGACY CLOCK REFERENCE/);
  assert.doesNotMatch(workshop, /CURRENT PRODUCTION CLOCK/);
});

test("Design Atlas and live worker Clock consume the same Study 15 presentation", () => {
  assert.match(portal, /<FutureClockFixture persona=\{persona\}/);
  assert.match(workshop, /<FutureClockFixture/);
  assert.match(workshop, /SHARED WORKER CLOCK · STUDY 15/);
  assert.match(futureClock, /WorkerClockSurface/);
  assert.doesNotMatch(futureClock, /clock-day-lab\/smart-day-study\.module\.css/);
  assert.match(futureClock, /data-atlas-future-clock="clock-study-15"/);
  assert.match(futureClock, /data-clock-day-source="execution-neighborhood"/);
  assert.match(futureClock, /data-atlas-clock-persona=\{persona\}/);
  assert.match(futureClock, /SCENARIOS: Record<WorkerPersona, ClockScenario>/);
  assert.match(futureClock, /role: "last"/);
  assert.match(futureClock, /role: "now"/);
  assert.match(futureClock, /role: "next"/);
  assert.match(futureClock, /role: "then"/);
  assert.match(workerClock, /data-atlas-worker-clock-surface="study-15-v1"/);
  assert.match(workerClock, /NEXT HARD EDGE/);
  assert.match(clockOrchestrator, /buildWorkerClockNeighborhood/);
  assert.match(clockOrchestrator, /<WorkerClockSurface/);
  assert.match(clockOrchestrator, /canManage \? <>/);
  assert.match(clockOrchestrator, /<ClockPlanningTimeline/);
  assert.match(clockOrchestrator, /<ClockDayShapeControl/);
  assert.match(futureClock, /DAY OWNS THE WHOLE DAY/);
  assert.match(futureClock, /CLOCK OWNS THE HANDS/);
  assert.match(futureClock, /REALITY REFLOWS QUIETLY/);
  assert.match(futureClock, /CONFLICT EARNS UI/);
  assert.match(futureClock, /carried, rescheduled, expired, held, or sent to management/);
  assert.match(futureClock, /data-live-data-binding="none"/);
  assert.match(futureClock, /data-mutation-capability="none"/);
});

test("Design Atlas splits Anna Harvest from Katie Buyer Desk without inventing live mutations", () => {
  assert.match(portal, /AnnaHarvestSurface/);
  assert.match(portal, /KatieBuyerDeskSurface/);
  assert.match(portal, /KatieCommercialHome/);
  assert.match(roleSurfaces, /data-atlas-harvest-fixture="worker-harvest-v1"/);
  assert.match(roleSurfaces, /data-atlas-buyer-desk="future-canonical-v1"/);
  assert.match(roleSurfaces, /<HarvestedOutputSection fixtureOnly fixtureData=\{HARVEST_FIXTURE\}/);
  assert.match(roleSurfaces, /Harvest stems/);
  assert.match(roleSurfaces, /Condition \+ bunch/);
  assert.match(roleSurfaces, /Available now/);
  assert.match(roleSurfaces, /Orders \+ fulfillment/);
  assert.match(harvest, /data-atlas-harvested|atlas-harvested/);
  assert.doesNotMatch(roleSurfaces, /fetch\(/);
});

test("Principal receives flower operating exceptions instead of worker harvest controls", () => {
  assert.match(portal, /PrincipalFlowerOpsSummary/);
  assert.match(roleSurfaces, /Production → commercial/);
  assert.match(roleSurfaces, /Friday inventory is under-committed/);
  assert.match(roleSurfaces, /Next Thursday supply is still field-evidence only/);
});

test("Workshop presents shared Worker Clock, legacy reference, and earlier studies in that order", () => {
  assert.match(workshop, /RealDayWorkshopFixture/);
  const sharedIndex = workshop.indexOf("<FutureClockFixture");
  const legacyIndex = workshop.indexOf("LEGACY CLOCK REFERENCE");
  const archiveIndex = workshop.indexOf("EDITOR STRESS TESTS");
  assert.ok(sharedIndex >= 0 && legacyIndex > sharedIndex && archiveIndex > legacyIndex);
});
