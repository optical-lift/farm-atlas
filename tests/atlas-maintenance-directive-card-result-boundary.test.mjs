import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const weed = readFileSync(new URL("../components/atlas/weed-card-task-focus.tsx", import.meta.url), "utf8");
const mow = readFileSync(new URL("../app/task-focus/[taskId]/MowingFocusPage.tsx", import.meta.url), "utf8");

test("directive strip is context while existing card controls own results", () => {
  assert.match(weed, /MaintenanceDirectiveStrip/);
  assert.match(weed, /postAtlasWeedCardSession/);
  assert.match(mow, /MaintenanceDirectiveStrip/);
  assert.match(mow, /TaskPrimaryResultControls/);
  assert.match(mow, /save\("mowed_full"\)/);
});
