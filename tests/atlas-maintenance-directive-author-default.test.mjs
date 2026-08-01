import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");
const composer = readFileSync(new URL("../components/atlas/maintenance-directive-composer.tsx", import.meta.url), "utf8");

test("manual work defaults to the current account rather than silently assigning an employee", () => {
  assert.match(core, /'viewerMembershipId', v_membership_id/);
  assert.match(composer, /next\.viewerMembershipId/);
});
