import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sql = readFileSync(join(root, "supabase/migrations/20260818213645_harvest_postharvest_preparation_process_lane_v1.sql"), "utf8");

test("Harvest preparation is a lawful process continuation rather than discretionary backlog", () => {
  assert.match(sql, /source_kind='flower_harvest_batch'/i);
  assert.match(sql, /task_type',''\)='flower_preparation/i);
  assert.match(sql, /new\.work_lane:='process_continuation'/i);
  assert.match(sql, /new\.commitment_kind:='dependency'/i);
  assert.match(sql, /Recorded physical harvest output requires postharvest handling before it can become Ready inventory/i);
  assert.match(sql, /harvest_output_requires_lawful_preparation_continuation/i);
});
