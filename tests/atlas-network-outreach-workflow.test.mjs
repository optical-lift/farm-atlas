import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dispatcher = readFileSync(
  new URL("../components/atlas/canonical-assigned-task-detail.tsx", import.meta.url),
  "utf8",
);
const detail = readFileSync(
  new URL("../components/atlas/network-outreach-task-detail.tsx", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../app/api/atlas/network-outreach/route.ts", import.meta.url),
  "utf8",
);
const taskMigration = readFileSync(
  new URL("../supabase/migrations/20260808173500_elm_church_outreach_thursday_batches.sql", import.meta.url),
  "utf8",
);
const workflowMigration = readFileSync(
  new URL("../supabase/migrations/20260808174800_network_outreach_workflow_v1.sql", import.meta.url),
  "utf8",
);

test("network outreach is a reusable checklist instrument inside the universal execution shell", () => {
  assert.match(dispatcher, /checklist_mode === "network_outreach"/);
  assert.match(dispatcher, /NetworkOutreachTaskDetail/);
  assert.match(detail, /AssignedTaskExecutionShell/);
  assert.match(detail, /data-atlas-method-instrument="network-outreach"/);
  assert.match(detail, /data-atlas-result-instrument="network-outreach"/);
  assert.doesNotMatch(detail, /TaskDominionTrail|atlas-phone-shell|\/api\/atlas\/weather/);
  assert.doesNotMatch(detail, /Faith Southern|Kingdom Church|Hope Church|Marshfield Assembly|Marshfield First/);
  assert.match(detail, /task\.metadata\?\.callback_number/);
  assert.match(detail, /task\.metadata\?\.outreach_script/);
  assert.match(detail, /task\.metadata\?\.thursday_options/);
  assert.match(detail, /task\.metadata\?\.thursday_slots/);
});

test("every contact records reality before the outreach batch can close", () => {
  assert.match(detail, /Interested/);
  assert.match(detail, /Maybe \/ follow up/);
  assert.match(detail, /Not interested/);
  assert.match(detail, /Left voicemail/);
  assert.match(detail, /No answer/);
  assert.match(detail, /Wrong contact \/ referred elsewhere/);
  assert.match(detail, /Save result \+ mark contacted/);
  assert.match(detail, /allContactsDone/);
  assert.match(detail, /finishBlocked = taskBusy \|\| !controller\.allContactsDone \|\| moveBlocked/);
  assert.match(detail, /disabled=\{finishBlocked\}/);
  assert.match(detail, /transition: "checklist_done"/);
});

test("outreach completion obeys canonical Task Move readiness before releasing the next batch", () => {
  assert.match(detail, /!assembly/);
  assert.match(detail, /assembly\.readiness\.status === "blocked"/);
  assert.match(detail, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(detail, /completion_source: "network_outreach_batch"/);
  assert.match(detail, /action: "release_next_batch"/);
  assert.match(detail, /window\.location\.assign\(returnHref\)/);
});

test("Thursday booking has an explicit restroom gate and writes canonical community events", () => {
  assert.match(detail, /restroomDisclosed/);
  assert.match(detail, /no guest restroom available/);
  assert.match(detail, /Book a Thursday if they’re ready/);
  assert.match(workflowMigration, /extract\(isodow from p_booking_date\) <> 4/);
  assert.match(workflowMigration, /event_kind = 'church_group_visit'/);
  assert.match(workflowMigration, /'thursdays_at_elm'/);
  assert.match(workflowMigration, /guest_restroom_available',false/);
  for (const start of ["09:30", "11:30", "13:30", "15:30"]) {
    assert.ok(workflowMigration.includes(`time '${start}'`));
  }
});

test("church batches carry the approved call kit and callback number", () => {
  assert.match(taskMigration, /\(417\) 319-4581/);
  assert.match(taskMigration, /10:00–11:30 AM/);
  assert.match(taskMigration, /I’m ready for the next five churches/);
  assert.match(taskMigration, /outreach_script/);
  assert.match(taskMigration, /voicemail_script/);
  assert.match(taskMigration, /guest_restroom_available', false/);
  assert.match(taskMigration, /next_batch_task_key/);
});

test("interactive network outreach writes only through authenticated governed RPCs", () => {
  assert.match(route, /createAtlasServerClient/);
  assert.doesNotMatch(route, /atlasSupabase/);
  assert.match(route, /record_network_outreach_result_v1/);
  assert.match(route, /release_network_outreach_batch_v1/);
  assert.match(workflowMigration, /security definer/i);
  assert.match(workflowMigration, /authenticated_rpc_registry/);
  assert.match(workflowMigration, /grant execute on function atlas\.record_network_outreach_result_v1/);
  assert.match(workflowMigration, /grant execute on function atlas\.release_network_outreach_batch_v1/);
});
