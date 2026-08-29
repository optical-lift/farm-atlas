import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const destinationCard = readFileSync(
  new URL("../components/atlas/destination-assigned-task-card.tsx", import.meta.url),
  "utf8",
);
const taskCardsRoute = readFileSync(
  new URL("../app/api/atlas/task-cards/route.ts", import.meta.url),
  "utf8",
);

test("destination cards re-resolve canonical task identity immediately before worker results", () => {
  assert.match(destinationCard, /resolveLiveTask\(\)/);
  assert.match(destinationCard, /\/api\/atlas\/task-cards\?taskId=/);
  assert.match(destinationCard, /const liveTask = await resolveLiveTask\(\)/);
  assert.match(destinationCard, /liveTask\.task_type === "flower_fulfillment"/);
  assert.match(destinationCard, /recordFlowerFulfillment\(liveTask, note\)/);
  assert.match(destinationCard, /taskId: liveTask\.task_id/);
  assert.match(destinationCard, /navigation\.complete\(liveTask\.task_id\)/);
  assert.doesNotMatch(destinationCard, /outcome === "done" && task\.task_type === "flower_fulfillment"/);
});

test("task-card reads follow superseded task identity only inside the authorized farm", () => {
  assert.match(taskCardsRoute, /MAX_SUPERSESSION_HOPS = 8/);
  assert.match(taskCardsRoute, /resolveSupersededTaskCard/);
  assert.match(taskCardsRoute, /\.eq\("farm_id", farmId\)/);
  assert.match(taskCardsRoute, /metadata\.superseded_by_task_id/);
  assert.match(taskCardsRoute, /visited\.has\(nextTaskId\)/);
  assert.match(taskCardsRoute, /canonicalTaskId/);
  assert.match(taskCardsRoute, /resolvedFromTaskId/);
  assert.match(taskCardsRoute, /readTaskCards\(supabase, operatorMembershipId, farmId, currentTaskId\)/);
});
