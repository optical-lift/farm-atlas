import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day reads one permission-scoped Worker Day while Week and Month retain the universal period collection", () => {
  const client = read("lib/atlas/task-cards-client.ts");
  const route = read("app/api/atlas/universal-task-cards/route.ts");
  const operatorReader = read("lib/atlas/operator-universal-home.ts");
  const adapter = read("lib/atlas/universal-task-cards.ts");
  const day = read("app/day/page.tsx");
  const week = read("app/overview/week/page.tsx");
  const month = read("app/overview/month/page.tsx");
  const operationalCards = read("lib/atlas/worker-day-operational-task-cards-server.ts");

  assert.match(client, /api\/atlas\/universal-task-cards/);
  assert.match(client, /atlasIsProjectTaskCard/);
  assert.doesNotMatch(client, /viewerWindow[\s\S]*api\/atlas\/home-task-cards/);

  assert.match(route, /getAtlasSession/);
  assert.match(route, /atlasUniversalViewerFromSession/);
  assert.match(route, /readAtlasOperatorUniversalHome/);
  assert.match(operatorReader, /readAtlasUniversalHome/);
  assert.match(route, /atlasUniversalTaskCards/);
  assert.match(route, /atlasUniversalPortalLabel/);
  assert.doesNotMatch(route, /requireAtlasApiAccess/);

  assert.match(adapter, /home\.farms\.flatMap/);
  assert.match(adapter, /home\.projectTasks\.map/);
  assert.match(adapter, /task_scope: "project"/);
  assert.match(adapter, /task_scope: "farm_operation"/);
  assert.match(adapter, /structured_result_required: true/);
  assert.doesNotMatch(adapter, /insert into atlas\.tasks/i);

  assert.match(day, /useAtlasWorkerDayProjection\(dateIso\)/);
  assert.match(day, /taskCards: tasks/);
  assert.doesNotMatch(day, /fetchAtlasTaskCards/);
  assert.match(operationalCards, /worker_day_operational_task_cards_v2/);
  assert.match(week, /fetchAtlasTaskCards\(\{ viewerScoped: true/);
  assert.match(month, /fetchAtlasTaskCards\(\{[\s\S]*viewerScoped: true/);
  assert.match(month, /\/task-focus\//);
});

test("dated collection identity is returned by the permission-scoped reader instead of patched into rendered headers", () => {
  const route = read("app/api/atlas/universal-task-cards/route.ts");
  const layout = read("app/layout.tsx");
  const adapter = read("lib/atlas/universal-task-cards.ts");

  assert.equal(existsSync(new URL("../app/UniversalCollectionIdentity.tsx", import.meta.url)), false);
  assert.doesNotMatch(layout, /UniversalCollectionIdentity/);
  assert.match(route, /portalLabel: atlasUniversalPortalLabel\(home\)/);
  assert.match(route, /hasFarmScope: home\.viewer\.hasFarmScope/);
  assert.match(route, /hasOrganizationScope: home\.viewer\.hasOrganizationScope/);
  assert.match(adapter, /organizationMembership\.role === "owner"/);
  assert.match(adapter, /home\.viewer\.farmMemberships\.length === 0/);
  assert.doesNotMatch(route, /MutationObserver|document\.querySelector/);
});

test("blocked tasks remain visible in universal period collections", () => {
  const overview = read("lib/atlas/task-overview.ts");
  assert.match(overview, /task\.status === "open" \|\| task\.status === "blocked"/);
  assert.match(overview, /return value \|\| "Atlas"/);
});
