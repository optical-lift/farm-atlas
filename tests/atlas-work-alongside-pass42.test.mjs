import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }
function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

const layout = read("app/layout.tsx");
const overlay = read("components/atlas/work-alongside/AtlasWorkAlongsideOverlay.tsx");
const route = read("app/api/atlas/work-alongside/route.ts");

test("Root layout gives Work Alongside the already-resolved effective farm role", () => {
  assert.match(layout, /const effectiveFarmRole = operatorContext\?\.isOperating/);
  assert.match(layout, /<AtlasWorkAlongsideOverlay effectiveFarmRole=\{effectiveFarmRole\} \/>/);
});

test("Farm Hand and non-management surfaces exit before Work Alongside readers mount", () => {
  const wrapper = section(overlay, "export default function AtlasWorkAlongsideOverlay", "\n}");
  assert.match(wrapper, /const canManage = effectiveFarmRole === "owner" \|\| effectiveFarmRole === "manager"/);
  assert.match(wrapper, /if \(!canManage\) return null/);
  assert.ok(wrapper.indexOf("if (!canManage) return null") < wrapper.indexOf('pathname === "/day"'));
  assert.doesNotMatch(wrapper, /fetch\(/);
});

test("Owner Day reuses AtlasRuntime task cards and does not request universal cards", () => {
  const ownerDay = section(overlay, "function OwnerDayWorkAlongsideBadges", "function ManagerDayWorkAlongsideBadges");
  assert.match(ownerDay, /useAtlasWorkerDayProjection\(selectedDate\)/);
  assert.match(ownerDay, /readWorkAlongsideSurface\(\)/);
  assert.doesNotMatch(ownerDay, /readUniversalDayTaskCards/);
  assert.doesNotMatch(ownerDay, /universal-task-cards/);
});

test("Manager Day keeps its existing management-compatible universal-card fallback", () => {
  const managerDay = section(overlay, "function ManagerDayWorkAlongsideBadges", "function WorkAlongsideSettings");
  assert.match(managerDay, /Promise\.all\(\[readWorkAlongsideSurface\(\), readUniversalDayTaskCards\(selectedDate\)\]\)/);
  assert.doesNotMatch(managerDay, /useAtlasWorkerDayProjection/);
  assert.match(route, /role: "owner" \| "manager"/);
});

test("More settings remain management-only and do not hydrate Day task cards", () => {
  const settings = section(overlay, "function WorkAlongsideSettings", "export default function AtlasWorkAlongsideOverlay");
  assert.match(settings, /readWorkAlongsideSurface\(\)/);
  assert.doesNotMatch(settings, /readUniversalDayTaskCards|useAtlasWorkerDayProjection/);
  assert.match(overlay, /if \(pathname === "\/more"\) return <WorkAlongsideSettings selectedDate=\{selectedDate\} \/>/);
});
