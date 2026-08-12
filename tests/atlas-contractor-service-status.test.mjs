import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/atlas/contractor-service-task-detail.tsx", import.meta.url), "utf8");
const canonical = await readFile(new URL("../components/atlas/canonical-assigned-task-detail.tsx", import.meta.url), "utf8");
const canonicalClient = await readFile(new URL("../components/atlas/canonical-assigned-task-detail-client.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/atlas/contractor-service/route.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260807162500_contractor_service_visit_status_v1.sql", import.meta.url), "utf8");


test("contractor status cards use a semantic Yes action instead of generic Done", () => {
  assert.match(canonical, /CanonicalAssignedTaskDetailClient/);
  assert.match(canonicalClient, /ContractorServiceTaskDetail/);
  assert.match(canonicalClient, /task\.task_type === "contractor_service_status"/);
  assert.match(component, /: "Yes"/);
  assert.doesNotMatch(component, /: "Done"/);
});


test("an off-day visit exposes an actual service date selector", () => {
  assert.match(component, /They came on a different day/);
  assert.match(component, /type="date"/);
  assert.match(component, /When did they come\?/);
  assert.match(component, /serviceDate: actualDate/);
});


test("confirmed contractor visits anchor the next cadence to the actual visit date", () => {
  assert.match(api, /record_contractor_service_visit_v1/);
  assert.match(migration, /v_next_date := p_service_date \+ v_cadence_days/);
  assert.match(migration, /next_expected_service_date/);
  assert.match(migration, /contractor_service_cadence/);
  assert.match(migration, /planned_due_date/);
});


test("not-yet keeps the question alive without falsely recording a visit", () => {
  assert.match(component, /Not yet/);
  assert.match(component, /transition: "rescheduled"/);
  assert.match(component, /contractorServiceStatus: "not_yet"/);
});
