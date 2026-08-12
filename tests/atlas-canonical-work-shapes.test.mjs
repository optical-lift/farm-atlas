import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const dayRoute = read("lib/atlas/day-route.ts");
const canonicalDetail = read("components/atlas/canonical-assigned-task-detail.tsx");
const canonicalClient = read("components/atlas/canonical-assigned-task-detail-client.tsx");
const serialGate = read("supabase/migrations/20260808235500_serial_queue_release_gate.sql");
const serialBehavior = read("supabase/migrations/20260808235600_serial_queue_release_behavior.sql");
const serialWeeding = read("supabase/migrations/20260808235620_reconcile_anna_serial_weeding.sql");
const calendarTruth = read("supabase/migrations/20260809003500_calendar_truth_and_serial_queue_semantics.sql");
const soilSequence = read("supabase/migrations/20260808235640_lock_soil_block_sequence.sql");
const batchTasks = read("supabase/migrations/20260808235700_consolidate_multi_tray_pot_up_batches.sql");

test("inspect-assess is one CHECK family while subtype keeps task behavior", () => {
  assert.match(dayRoute, /operationClass === "inspect_assess"\) return "Check"/);
  assert.match(dayRoute, /germination_check: "Germination check"/);
  assert.match(canonicalDetail, /CanonicalAssignedTaskDetailClient/);
  assert.match(canonicalClient, /isExecutionChecklistTask/);
  assert.match(canonicalClient, /WeedCardTaskLoader/);
});

test("serial queue membership is authoritative at the final occurrence gate", () => {
  assert.match(serialGate, /planned_occurrence_id=occurrence\.id and qi\.state='queued'/);
  assert.match(serialGate, /active_item\.state='active'/);
  assert.match(serialGate, /qi\.position=\(select min\(head\.position\)/);
  assert.match(serialGate, /anna_weeding_rotation/);
  assert.match(serialGate, /task_release_queue_items_one_serial_active_v1/);
});

test("Anna weeding has one released card while ordinary backlog stays off the calendar", () => {
  assert.match(serialWeeding, /reconcile_anna_serial_weeding_v1/);
  assert.match(serialWeeding, /queue_key='anna_weeding_rotation'/);
  assert.match(serialWeeding, /status='archived'/);
  assert.match(serialWeeding, /Waiting behind the current Weed Card in Anna serial weeding/);
  assert.match(serialWeeding, /v_serial:=atlas\.reconcile_anna_serial_weeding_v1/);
  assert.match(calendarTruth, /calendar_commitment_kind','queue_only'/);
  assert.match(calendarTruth, /planned_due_date=null,not_before_date=null/);
  assert.match(calendarTruth, /release_queue_scheduled_after_count/);
  assert.match(dayRoute, /release_queue_scheduled_after_count/);
  assert.doesNotMatch(dayRoute, /release_queue_queued_count/);
  assert.doesNotMatch(dayRoute, /attention after this one/);
});

test("soil-block making is a real same-day continuation after soil preparation", () => {
  assert.match(soilSequence, /anna_soil_block_1_5_sequence/);
  assert.match(soilSequence, /anna_20260804_prepare_soil_1_5_blocks/);
  assert.match(soilSequence, /anna_20260804_make_1_5_soil_blocks/);
  assert.match(soilSequence, /'same_day'/);
  assert.match(soilSequence, /2,'queued'/);
  assert.match(serialBehavior, /v_release_timing='same_day'/);
  assert.match(serialBehavior, /v_due_date:=v_completed_date/);
});

test("multi-tray pot-up work is one executable task with required tray lines", () => {
  assert.match(batchTasks, /task_execution_checklist_items/);
  assert.match(batchTasks, /'task_work_shape','batch'/);
  assert.match(batchTasks, /'batch_item_kind','tray'/);
  assert.match(batchTasks, /execution_checklist_template_key/);
  assert.match(batchTasks, /status='archived'/);
  assert.match(batchTasks, /Consolidated into one crop pot-up task before work began/);
  assert.match(canonicalClient, /return <ExecutionChecklistTaskDetail/);
});

test("legacy multi-item initial batches stay compatible with serial release helper", () => {
  assert.match(serialBehavior, /qi\.initial_batch/);
  assert.match(serialBehavior, /qi\.state<>'completed'/);
  assert.match(serialBehavior, /return null/);
});
