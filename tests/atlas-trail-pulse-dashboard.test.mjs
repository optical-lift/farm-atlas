import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const home = fs.readFileSync("components/atlas/home/AtlasUniversalHome.tsx", "utf8");
const board = fs.readFileSync("components/atlas/home/AtlasTrailPulseBoard.tsx", "utf8");
const styles = fs.readFileSync("components/atlas/home/trail-pulse.module.css", "utf8");
const route = fs.readFileSync("app/api/atlas/trail-pulse/route.ts", "utf8");

test("the universal home displays the shared Trail Pulse board inside the existing Atlas home grid", () => {
  assert.match(home, /import AtlasTrailPulseBoard/);
  assert.match(home, /<AtlasTrailPulseBoard \/>/);
  assert.match(home, /<AtlasFooterActions[\s\S]*?<AtlasTrailPulseBoard \/>[\s\S]*?id="work-board"/);
});

test("Trail Pulse is limited to Feast Guild organization scope before the Trail RPC runs", () => {
  assert.match(route, /getAtlasSession\(\)/);
  assert.match(route, /atlasUniversalViewerFromSession\(session\)/);
  assert.match(route, /!viewer\.hasOrganizationScope \|\| !viewer\.activeOrganizationId/);
  assert.match(route, /return privateJson\(\{ ok: true, pulse: \[\] \}\)/);
  assert.match(route, /universal_trail_pulse_v1/);
  assert.match(route, /p_organization_id: viewer\.activeOrganizationId/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.ok(
    route.indexOf("!viewer.hasOrganizationScope") < route.indexOf("universal_trail_pulse_v1"),
    "farm-only sessions must be returned before the organization Pulse RPC runs",
  );
});

test("the visible pulse returns every current Trail state to a normal Atlas destination", () => {
  for (const state of ["moving", "blocked", "waiting", "review", "missing_release"]) {
    assert.match(board, new RegExp(`\\"${state}\\"`));
  }
  assert.match(board, /href=\{item\.href\}/);
  assert.match(board, /Current task ·/);
  assert.match(board, /No task is released for/);
  assert.match(board, /pendingEvidenceCount/);
});

test("Trail Pulse shares the home card geometry and keeps later dashboard sections in order", () => {
  assert.match(board, /AtlasCard as="section" id="trail-pulse"/);
  assert.match(board, /AtlasSectionHeading/);
  assert.match(board, /AtlasStateBadge/);
  assert.match(styles, /grid-column: 1 \/ -1/);
  assert.match(styles, /#work-board[\s\S]*order: 6 !important/);
  assert.match(styles, /#scope-board[\s\S]*order: 7 !important/);
});
