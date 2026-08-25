import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const frame = fs.readFileSync("components/atlas/task-card-frame.tsx", "utf8");
const farmRound = fs.readFileSync("components/atlas/farm-round-task-detail.tsx", "utf8");
const transitionRoute = fs.readFileSync("app/api/atlas/task-transition/route.ts", "utf8");
const warrant = fs.readFileSync("supabase/migrations/20260825170030_farm_round_member_completion_warrant_v1.sql", "utf8");

test("shared task-card footer requires executable completion actions", () => {
  assert.match(frame, /type InteractiveCompletionProps = \{[\s\S]*?onDone: \(\) => void;[\s\S]*?onUnfinished: \(\) => void;/);
  assert.match(frame, /onClick=\{props\.onDone\}>Done<\/button>/);
  assert.match(frame, /onClick=\{props\.onUnfinished\}>Unfinished<\/button>/);
});

test("Farm Round terminal completion uses canonical child transitions then returns to the day feed", () => {
  assert.match(farmRound, /async function completeRound\(\)/);
  assert.match(farmRound, /transition: "done"/);
  assert.match(farmRound, /farmRoundTerminalAction: true/);
  assert.match(farmRound, /window\.location\.assign\(returnPath\(assignee\)\)/);
  assert.match(farmRound, /onDone=\{\(\) => void completeRound\(\)\}/);
  assert.match(farmRound, /onUnfinished=\{leaveUnfinished\}/);
});

test("checking the final Farm Round member still follows the same terminal return path", () => {
  assert.match(farmRound, /nextMembers\.every\(\(candidate\) => isDone\(candidate\)\)/);
  assert.match(farmRound, /window\.setTimeout\(\(\) => window\.location\.assign\(returnPath\(assignee\)\), 120\)/);
});

test("assigned Farm Round member Done uses the bounded member warrant on the shared transition route", () => {
  assert.match(farmRound, /farmRoundParentTaskId: task\.task_id, farmRoundMember: true/);
  assert.match(transitionRoute, /rpcName === "worker_record_task_transition_v1"[\s\S]*input\.transition === "done"[\s\S]*input\.payload\?\.farmRoundMember === true/);
  assert.match(transitionRoute, /worker_record_farm_round_member_done_v1/);
  assert.match(transitionRoute, /p_task_id: input\.taskId/);
  assert.match(transitionRoute, /p_payload: input\.payload/);
});

test("Farm Round member warrant validates exact current-day aggregate jurisdiction without child placement", () => {
  assert.match(warrant, /v_task\.parent_task_id is distinct from v_parent_id/);
  assert.match(warrant, /v_parent\.task_type <> 'stewardship_round'/);
  assert.match(warrant, /v_parent\.assigned_membership_id is distinct from v_membership_id/);
  assert.match(warrant, /v_parent\.due_date is distinct from v_service_date/);
  assert.match(warrant, /v_task\.due_date is distinct from v_service_date/);
  assert.match(warrant, /farm_round_grouping_v1/);
  assert.match(warrant, /prerequisitesReady/);
  assert.match(warrant, /destinationReady/);
  assert.match(warrant, /seedReady/);
  assert.match(warrant, /stateConsequenceClear/);
  assert.match(warrant, /resource_truth_not_inferred/);
  assert.match(warrant, /return atlas\.record_task_transition_v1/);
  assert.doesNotMatch(warrant, /insert into atlas\.worker_day_task_placements/i);
  assert.doesNotMatch(warrant, /resourcesReady/);
});
