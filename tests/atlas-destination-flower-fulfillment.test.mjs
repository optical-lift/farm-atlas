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
  assert.match(contact, /destination\.contactName \? "Ask for" : "Handoff"/);
  assert.match(contact, /destination\.contactName/);
});

test("Done on a destination flower fulfillment resolves current task identity before recording handoff", () => {
  const card = read("components/atlas/destination-assigned-task-card.tsx");
  const taskCardsApi = read("app/api/atlas/task-cards/route.ts");
  const fulfillmentApi = read("app/api/atlas/flower-fulfillment/route.ts");

  assert.match(card, /const liveTask = await resolveLiveTask\(\)/);
  assert.match(card, /outcome === "done" && liveTask\.task_type === "flower_fulfillment"/);
  assert.match(card, /fetch\("\/api\/atlas\/flower-fulfillment"/);
  assert.match(card, /taskId: liveTask\.task_id/);
  assert.match(card, /idempotencyKey/);
  assert.match(card, /await recordFlowerFulfillment\(liveTask, note\);\s*navigation\.complete\(liveTask\.task_id\);\s*return;/);
  assert.match(taskCardsApi, /metadata\.superseded_by_task_id/);
  assert.match(taskCardsApi, /canonicalTaskId/);
  assert.match(fulfillmentApi, /record_flower_fulfillment_for_member_v1/);
  assert.match(fulfillmentApi, /owner_operator_record_flower_fulfillment_v1/);
});
