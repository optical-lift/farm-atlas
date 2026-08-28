import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("off-site flower fulfillment uses the destination handoff card", () => {
  const loader = read("components/atlas/flower-fulfillment-task-loader.tsx");
  const contact = read("components/atlas/task-destination-contact.tsx");

  assert.match(loader, /DestinationAssignedTaskCard, \{ isDestinationTask \}/);
  assert.match(loader, /if \(isDestinationTask\(task\)\) \{/);
  assert.match(loader, /return <DestinationAssignedTaskCard task=\{task\} childTasks=\{childTasks\} assignee=\{assignee\} \/>/);
  assert.match(contact, />Ask for</);
  assert.match(contact, /destination\.contactName/);
});

test("Done on a destination flower fulfillment records fulfillment before leaving the task", () => {
  const card = read("components/atlas/destination-assigned-task-card.tsx");
  const api = read("app/api/atlas/flower-fulfillment/route.ts");

  assert.match(card, /outcome === "done" && task\.task_type === "flower_fulfillment"/);
  assert.match(card, /fetch\("\/api\/atlas\/flower-fulfillment"/);
  assert.match(card, /idempotencyKey/);
  assert.match(card, /await recordFlowerFulfillment\(note\);\s*navigation\.complete\(task\.task_id\);\s*return;/);
  assert.match(api, /record_flower_fulfillment_for_member_v1/);
  assert.match(api, /owner_operator_record_flower_fulfillment_v1/);
});
