import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day Week and Month read one permission-scoped farm and project task collection", () => {
  const client = read("lib/atlas/task-cards-client.ts");
  const route = read("app/api/atlas/universal-task-cards/route.ts");
  const adapter = read("lib/atlas/universal-task-cards.ts");
  const day = read("app/day/page.tsx");
  const week = read("app/overview/week/page.tsx");
  const month = read("app/overview/month/page.tsx");

  assert.match(client, /api\/atlas\/universal-task-cards/);
  assert.match(client, /atlasIsProjectTaskCard/);
  assert.doesNotMatch(client, /viewerWindow[\s\S]*api\/atlas\/home-task-cards/);

  assert.match(route, /getAtlasSession/);
  assert.match(route, /atlasUniversalViewerFromSession/);
  assert.match(route, /readAtlasUniversalHome/);
  assert.match(route, /atlasUniversalTaskCards/);
  assert.match(route, /atlasUniversalPortalLabel/);
  assert.doesNotMatch(route, /requireAtlasApiAccess/);

  assert.match(adapter, /home\.farms\.flatMap/);
  assert.match(adapter, /home\.projectTasks\.map/);
  assert.match(adapter, /task_scope: "project"/);
  assert.match(adapter, /task_scope: "farm_operation"/);
  assert.match(adapter, /structured_result_required: true/);
  assert.doesNotMatch(adapter, /insert into atlas\.tasks/i);

  assert.match(day, /fetchAtlasTaskCards\(\{ viewerScoped: true/);
  assert.match(week, /fetchAtlasTaskCards\(\{ viewerScoped: true/);
  assert.match(month, /fetchAtlasTaskCards\(\{[\s\S]*viewerScoped: true/);
  assert.match(month, /\/task-focus\//);
});

test("dated collection identity comes from membership scope instead of a role-owned portal", () => {
  const identity = read("app/UniversalCollectionIdentity.tsx");
  const layout = read("app/layout.tsx");
  const adapter = read("lib/atlas/universal-task-cards.ts");

  assert.match(layout, /<UniversalCollectionIdentity \/>/);
  assert.match(identity, /pathname === "\/day"/);
  assert.match(identity, /pathname === "\/overview\/week"/);
  assert.match(identity, /pathname === "\/overview\/month"/);
  assert.match(identity, /portalLabel/);
  assert.match(identity, /hasFarmScope === false/);
  assert.match(adapter, /organizationMembership\.role === "owner"/);
  assert.match(adapter, /home\.viewer\.farmMemberships\.length === 0/);
  assert.doesNotMatch(identity, /Anna|Katie|consultant|farm_hand/i);
});

test("blocked tasks remain visible in universal period collections", () => {
  const overview = read("lib/atlas/task-overview.ts");
  assert.match(overview, /task\.status === "open" \|\| task\.status === "blocked"/);
  assert.match(overview, /return value \|\| "Atlas"/);
});
