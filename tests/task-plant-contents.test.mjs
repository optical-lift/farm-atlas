import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("every weed task routes to the occupancy-aware persistent Weed Card inside the universal shell", () => {
  const boundary = read("components/atlas/canonical-assigned-task-detail.tsx");
  const canonical = read("components/atlas/canonical-assigned-task-detail-client.tsx");
  const loader = read("components/atlas/weed-card-task-loader.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const occupancy = read("components/atlas/crop-occupancy-list.tsx");

  assert.match(boundary, /workerExecutionTaskCard/);
  assert.match(canonical, /isWeedTask/);
  assert.match(canonical, /if \(isWeedTask\(props\.task\)\) return <WeedCardTaskLoader/);
  assert.doesNotMatch(canonical, /<ConciseWeedTaskDetail/);
  assert.match(loader, /<AssignedTaskExecutionShell task=\{task\} childTasks=\{childTasks\} assignee=\{assignee\} \/>/);
  assert.match(loader, /childTasks=\{childTasks\}/);
  assert.doesNotMatch(loader, /ConciseWeedTaskDetail/);
  assert.match(focus, /AssignedTaskExecutionShell/);
  assert.match(focus, /<CropOccupancyList groups=\{card\.occupancyGroups\} \/>/);
  assert.match(focus, /data-atlas-method-instrument="weed-card"/);
  assert.match(focus, /methodInstrument=\{methodInstrument\}/);
  assert.match(focus, /resultInstrument=\{resultInstrument\}/);
  assert.doesNotMatch(focus, /TaskDominionTrail|showSubjectLabel|moveDetails=|presentation="weed-sheet"/);
  assert.match(shell, /methodInstrument \? methodInstrument\(instrumentContext\)/);
  assert.match(occupancy, /group\.groupLabel/);
  assert.match(occupancy, /cohort\.placementSummary/);
  assert.match(occupancy, /cohort\.stageLabel/);
  assert.doesNotMatch(focus, /Continue the recovery|Current move|Keep the planted material|permanent edge/);
});

test("legacy object contents remain evidence while Weed Cards read canonical occupancy", () => {
  const legacyRoute = read("app/api/atlas/task-plant-contents/route.ts");
  const legacyMigration = read("supabase/migrations/20260729084100_task_plant_contents_v1.sql");
  const reader = read("supabase/migrations/20260729151700_crop_occupancy_reader_v1.sql");
  const contract = read("lib/atlas/weed-card-contract.ts");

  assert.match(legacyRoute, /task_plant_contents_v1/);
  assert.match(legacyMigration, /join atlas\.object_contents oc/);
  assert.match(legacyMigration, /'Lemon balm', 'perennial', 'established'/);
  assert.match(legacyMigration, /set content_label = 'Iris'/);
  assert.match(reader, /object_crop_occupancy_v1/);
  assert.match(reader, /'occupancyGroups'/);
  assert.match(reader, /crop_placements/);
  assert.match(reader, /crop_observations/);
  assert.match(reader, /groupKind/);
  assert.match(contract, /occupancyGroups: AtlasCropOccupancyGroup\[\]/);
  assert.doesNotMatch(contract, /plants: AtlasWeedPlant\[\]/);
});
