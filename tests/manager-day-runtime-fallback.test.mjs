import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const layout = read("app/layout.tsx");
const runtime = read("components/atlas/runtime/AtlasRuntimeProvider.tsx");

test("Root layout passes the resolved effective farm role into AtlasRuntime", () => {
  assert.match(layout, /<AtlasRuntimeProvider[^>]*effectiveFarmRole=\{effectiveFarmRole\}/s);
});

test("Manager Day keeps the universal task-card compatibility path", () => {
  assert.match(runtime, /const managerMode = runtime\.effectiveFarmRole === "manager"/);
  assert.match(runtime, /if \(managerMode\) \{\s*void readManagerDay\(\);\s*return;\s*\}/);
  assert.match(runtime, /fetchAtlasTaskCards\(\{[\s\S]*viewerScoped: true,[\s\S]*dueThrough: dateIso,[\s\S]*doneDate: dateIso,[\s\S]*exactDate: dateIso > today \? dateIso : undefined/);
  assert.match(runtime, /if \(managerMode\) \{[\s\S]*projection: null,[\s\S]*taskCards: managerTaskCards,[\s\S]*canManage: true/);
});

test("Manager fallback does not reinterpret Manager as Farm Hand Worker Day", () => {
  const hookStart = runtime.indexOf("export function useAtlasWorkerDayProjection");
  assert.ok(hookStart >= 0);
  const hook = runtime.slice(hookStart);
  const managerBranch = hook.indexOf("if (managerMode)");
  const workerRead = hook.indexOf("runtime.readWorkerDay(dateIso)");
  assert.ok(managerBranch >= 0 && workerRead > managerBranch);
  assert.match(hook, /if \(managerMode\) \{\s*void readManagerDay\(\);\s*return;\s*\}\s*if \(!entry\) void runtime\.readWorkerDay/);
});

test("Manager task transitions trigger a compatibility refetch", () => {
  assert.match(runtime, /if \(!serviceDates\.size\) \{\s*const response = await commitAtlasTaskTransition\(request\);\s*if \(effectiveFarmRole === "manager"\) notify\(\);\s*return response;/);
});
