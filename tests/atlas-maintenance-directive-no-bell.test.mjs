import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const files = [
  "../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql",
  "../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql",
  "../supabase/migrations/20260801043200_atlas_maintenance_directives_completion_v1.sql",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

test("ordinary directive authoring and release do not create Bell history", () => {
  assert.doesNotMatch(files, /bell_event_receipts|bell_monitoring_baselines|bell_history/i);
});
