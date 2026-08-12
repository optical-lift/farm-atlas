import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const contract = read("lib/atlas/worker-execution-contract.ts");
const taskMoveRoute = read("app/api/atlas/task-move/route.ts");
const taskCardsRoute = read("app/api/atlas/task-cards/route.ts");
const universalRoute = read("app/api/atlas/universal-task-cards/route.ts");
const taskDetailServer = read("components/atlas/canonical-assigned-task-detail.tsx");

test("Farm Hand metadata is explicit allow-list, not a deny-list copy of Owner task metadata", () => {
  assert.match(contract, /WORKER_EXECUTION_METADATA_KEYS = new Set/);
  for (const allowed of [
    "display_action",
    "display_subject",
    "display_location",
    "execution_do",
    "execution_place",
    "execution_how",
    "execution_done_when",
    "worker_context",
    "rows_per_3ft_bed",
    "in_row_spacing_in",
    "repeat_interval_days",
  ]) {
    assert.match(contract, new RegExp(`"${allowed}"`));
  }

  for (const ownerOnly of [
    "why_now",
    "state_effect",
    "priority_reasons",
    "bed_truth_note",
    "owner_schedule_reason",
    "owner_current_truth_source",
    "release_reason",
    "stale_oregano_unlock_reason",
  ]) {
    assert.doesNotMatch(contract, new RegExp(`"${ownerOnly}"`));
  }
});

test("worker task card strips free-form strategy, history, and object-state payloads", () => {
  assert.match(contract, /unlock_text: null/);
  assert.match(contract, /note: null/);
  assert.match(contract, /task_logs: \[\]/);
  assert.match(contract, /task_outcomes: \[\]/);
  assert.match(contract, /task_transitions: \[\]/);
  assert.match(contract, /state_metadata: null/);
  assert.match(contract, /resource_requirements: .*map\(workerResourceRequirement\)/s);
  assert.match(contract, /condition_notes: null/);
});

test("worker Day placement cannot serialize the Owner placement reason", () => {
  assert.match(contract, /key === "day_placement"/);
  assert.match(contract, /placementSource: placement\.placementSource/);
  assert.doesNotMatch(contract, /placementReason: placement\.placementReason/);
});

test("worker Task Move removes strategy context and rich current-state commentary", () => {
  assert.match(contract, /current: \[\]/);
  assert.match(contract, /projects: \[\]/);
  assert.match(contract, /unlocks: \[\]/);
  assert.match(contract, /whyNow: null/);
  assert.match(contract, /stateEffect: null/);
  assert.match(contract, /details: null/);
});

test("Farm Hand API surfaces apply the execution contract", () => {
  assert.match(taskMoveRoute, /effectiveRole === "farm_hand"[\s\S]*workerExecutionTaskMove\(assembly\)/);
  assert.match(taskCardsRoute, /effectiveRole === "farm_hand"[\s\S]*workerExecutionTaskCards\(enrichedTaskCards\)/);
  assert.match(universalRoute, /effectiveRole === "farm_hand"[\s\S]*workerExecutionTaskCards\(enrichedTaskCards\)/);
});

test("Anna generic Task Focus is sanitized before Server Component props reach the client", () => {
  assert.doesNotMatch(taskDetailServer, /"use client"/);
  assert.match(taskDetailServer, /props\.assignee\.key !== "anna"/);
  assert.match(taskDetailServer, /task=\{workerExecutionTaskCard\(props\.task\)\}/);
  assert.match(taskDetailServer, /childTasks=\{workerExecutionTaskCards\(props\.childTasks\)\}/);
});
