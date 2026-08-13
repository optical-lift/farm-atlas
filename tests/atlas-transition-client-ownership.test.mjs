import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("task transition client owns transport, not checklist DOM state", () => {
  const client = read("lib/atlas/task-transition-client.ts");
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const checklist = read("components/atlas/task-child-checklist.tsx");
  const stateful = read("components/atlas/stateful-child-checklist.tsx");

  assert.doesNotMatch(client, /MutationObserver/);
  assert.doesNotMatch(client, /querySelector/);
  assert.doesNotMatch(client, /data-child-task-id/);
  assert.doesNotMatch(client, /classList/);
  assert.match(client, /transition client owns transport only/i);
  assert.match(shell, /refreshTaskAndChildren/);
  assert.match(shell, /<StatefulChildChecklist childTasks=\{statefulChildren\} onChange=\{refreshTaskAndChildren\}/);
  assert.match(shell, /<TaskChildChecklist childTasks=\{ordinaryChildren\} onChange=\{refreshTaskAndChildren\}/);
  assert.match(checklist, /const \[savingId, setSavingId\]/);
  assert.match(stateful, /postAtlasTaskTransition/);
  assert.match(stateful, /transition: next === "done" \? "checklist_done" : "checklist_open"/);
});
