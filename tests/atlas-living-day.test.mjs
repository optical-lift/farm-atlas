import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const reconciliation = read("supabase/migrations/20260729080000_living_day_fr15_sowing_reconciliation_v1.sql");
const reader = read("supabase/migrations/20260729080100_living_day_reader_v1.sql");
const ownerDecisionScope = read("supabase/migrations/20260729080200_living_day_owner_decision_scope_v1.sql");
const contract = read("lib/atlas/living-day-contract.ts");
const client = read("lib/atlas/living-day-client.ts");
const route = read("app/api/atlas/living-day/route.ts");
const primitives = read("components/atlas/living-day-primitives.tsx");
const day = read("app/day/page.tsx");
const css = read("app/living-journal.css");
const layout = read("app/layout.tsx");
const sql = `${reconciliation}\n${reader}\n${ownerDecisionScope}`;

const approvedGoalKeys = [
  "elm_eb1_eb6_procut_open_v1",
  "elm_fr11_fr14_october_sunflowers_v1",
  "elm_fr15_procut_horizon_stand_v1",
  "elm_fr4_fr6_first_zinnia_cut_v1",
];

test("Living Day projects exactly the four Owner-approved Elm goals", () => {
  for (const key of approvedGoalKeys) {
    assert.match(reader, new RegExp(key));
    assert.match(contract, new RegExp(key));
  }
  assert.match(reader, /v_goals := jsonb_build_array\(v_fr15_goal, v_fr_goal, v_zinnia_goal, v_eb_goal\)/);
  assert.doesNotMatch(sql, /create table[^;]*goal/i);
});

test("FR15 sowing is reconciled from the completed canonical task instead of migration time", () => {
  assert.match(reconciliation, /anna_20260724_sow_procut_horizon_fr15/);
  assert.match(reconciliation, /status = 'done'/);
  assert.match(reconciliation, /coalesce\(due_date, completed_at::date\)/);
  assert.match(reconciliation, /crop_cycle_key = 'planned_fr15_procut_horizon_20260724'/);
  assert.match(reconciliation, /lifecycle_status = 'active'/);
  assert.match(reconciliation, /cycle_state = 'sown'/);
  assert.match(reconciliation, /uses_migration_time_as_sowing_date', false/);
  assert.match(reconciliation, /sowing_evidence_source', 'completed_task_result'/);
});

test("the goals advance only from canonical blockers results cycles and observations", () => {
  assert.match(reader, /owner_20260726_mark_spray_eb1_6/);
  assert.match(reader, /entry_billboard_pollenless_2026_s1_parent/);
  assert.match(reader, /v_eb_sown_count = 6/);
  assert.match(reader, /fr_black_oil_turnover_pollenless_fr11_20260730/);
  assert.match(reader, /v_fr_sown_count = 4/);
  assert.match(reader, /cycle\.germination_checked_date is not null/);
  assert.match(reader, /contract_packet_key' = 'anna_20260726_20260729_40h'/);
  assert.match(reader, /cycle\.harvest_started_date is not null/);
  assert.match(reader, /partialDoesNotSatisfy', true/);
  assert.match(reader, /timeDoesNotConfirmStand', true/);
  assert.match(reader, /timeDoesNotProveHarvest', true/);
});

test("Owner decisions stay bounded to the two FR and EB pilot decisions", () => {
  assert.match(ownerDecisionScope, /rename to living_day_base_v1/);
  assert.match(ownerDecisionScope, /owner_20260726_mark_spray_eb1_6/);
  assert.match(ownerDecisionScope, /entry_billboard_pollenless_2026_s1_parent/);
  assert.match(ownerDecisionScope, /task\.parent_task_id is null/);
  assert.match(ownerDecisionScope, /'excludedFromDenominator', true/);
  assert.doesNotMatch(ownerDecisionScope, /due_date <=/);
});

test("carried failures and goals stay outside the bounded Day denominator internally", () => {
  assert.match(reader, /state\.state in \('fallen_out_of_rhythm', 'recovering'\)/);
  assert.match(reader, /'excludedFromDenominator', true/);
  assert.match(reader, /'denominator', 'bounded_day_plan_only'/);
  assert.match(reader, /'carriedExcluded', true/);
  assert.match(reader, /'goalsExcluded', true/);
  assert.match(reader, /'unlockedTodayExcluded', true/);
  assert.match(day, /data-day-denominator=\{`\$\{finishedProgressTasks\.length\}\/\$\{progressTasks\.length\}`\}/);
  assert.match(day, /completed=\{finishedProgressTasks\.length\} total=\{progressTasks\.length\}/);
  assert.doesNotMatch(primitives, /denominator/i);
});

test("the Living Day API remains private membership-scoped and failure-isolated from task loading", () => {
  assert.match(route, /getAtlasSession/);
  assert.match(route, /session\.activeFarmId \?\? session\.memberships\[0\]\?\.farmId/);
  assert.match(route, /rpc\("living_day_v1"/);
  assert.match(route, /Cache-Control": "private, max-age=0, must-revalidate/);
  assert.match(route, /X-Atlas-Read-Path": "living-day-v1/);
  assert.match(client, /\/api\/atlas\/living-day/);
  assert.match(day, /Journal view unavailable\. Today’s tasks remain usable\./);
  assert.match(reader, /not atlas\.is_farm_member\(p_farm_id\)/);
});

test("task rows expand inline while the separate completion dot keeps its action", () => {
  assert.match(day, /<details id=\{onNodePress \? undefined : taskAnchorId\(task\)\} className=\{`\$\{className\} atlas-journal-task-row`\}/);
  assert.match(day, /<dl>/);
  assert.match(day, /<dt>Place<\/dt>/);
  assert.match(day, /<dt>Time<\/dt>/);
  assert.match(day, /<dt>Evidence<\/dt>/);
  assert.match(day, /<dt>Effect<\/dt>/);
  assert.match(day, /className=\{`atlas-day-task-node/);
  assert.match(day, /onClick=\{\(\) => onNodePress\(task\)\}/);
  assert.match(day, /atlas-day-mixed-timeline/);
  assert.match(css, /Tapping the row opens context/);
});

test("completion echoes remain compact but say what changed", () => {
  assert.match(day, /atlas-journal-completion-echo-copy/);
  assert.match(day, /event\?\.detail \|\| task\.task_outcomes/);
  assert.match(day, /Journal · \$\{event\.sourceEvent/);
  assert.match(css, /readable echo of its effect/);
  assert.match(css, /atlas-day-completion-echo \{/);
});

test("farm goals show unmet requirements and only link to existing work", () => {
  assert.match(primitives, /Farm goals/);
  assert.match(primitives, /goal\.requirements\.map/);
  assert.match(primitives, /Open next move/);
  assert.match(primitives, /Waiting for the next recorded condition/);
  assert.match(reader, /'playability', 'existing_task_only'/);
  assert.doesNotMatch(sql, /insert into atlas\.tasks/i);
  assert.doesNotMatch(sql, /release_eligible_work_v1/i);
});

test("Journal dots, state changes, and day summary are present without rebuilding Home", () => {
  assert.match(day, /<LivingDayJournal/);
  assert.match(day, /<LivingDayUnlocked/);
  assert.match(day, /<LivingDayCompletionSummary/);
  assert.match(primitives, /What changed today/);
  assert.match(primitives, /Newly available/);
  assert.match(primitives, /unlocks\.filter\(\(unlock\) => !unlock\.taskId\)/);
  assert.match(primitives, /What the day changed/);
  assert.match(layout, /\.\/living-journal\.css/);
  assert.match(css, /Shared Living Journal primitives/);
  assert.doesNotMatch(`${primitives}\n${css}`, /home hero|purple hero/i);
});
