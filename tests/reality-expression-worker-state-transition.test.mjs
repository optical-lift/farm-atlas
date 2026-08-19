import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const phase5 = readFileSync(
  "supabase/migrations/20260818004924_reality_expression_worker_state_transition_card_v1.sql",
  "utf8",
);
const phase5IdentityFix = readFileSync(
  "supabase/migrations/20260818005256_worker_state_transition_crop_operation_identity_fix_v1.sql",
  "utf8",
);
const phase6 = readFileSync(
  "supabase/migrations/20260818021658_reality_expression_structured_result_return_v1.sql",
  "utf8",
);
const germinationAdapter = readFileSync(
  "supabase/migrations/20260818022008_reality_expression_structured_result_germination_adapter_v1.sql",
  "utf8",
);
const singleLotFix = readFileSync(
  "supabase/migrations/20260818022129_reality_expression_structured_result_single_lot_fix_v1.sql",
  "utf8",
);
const idempotencyFix = readFileSync(
  "supabase/migrations/20260818022546_reality_expression_structured_result_idempotency_namespace_v1.sql",
  "utf8",
);

test("Phase 5 makes Worker Day a Reality Expression projection rather than task authority", () => {
  assert.match(
    phase5,
    /create or replace function atlas\.worker_state_transition_card_v1\(/i,
  );
  assert.match(
    phase5,
    /create or replace function atlas\.worker_day_state_transition_cards_v1\(/i,
  );
  for (const token of [
    "taskIsNotSourceOfReality",
    "placementIsRoutingNotReality",
    "assignmentIsNotOperationWarrant",
    "unresolvedRealityCannotYieldAuthorizedInstruction",
    "workerMustNotInfer",
  ]) {
    assert.match(phase5, new RegExp(token, "i"));
  }
});

test("Phase 5 crop operation identity is proven by the canonical current task", () => {
  assert.match(phase5IdentityFix, /fittingOperation,currentTaskId/i);
  assert.match(phase5IdentityFix, /canonical_current_task_match/i);
  assert.match(phase5IdentityFix, /available','required/i);
  assert.match(
    phase5IdentityFix,
    /currentTaskId establishes operation identity/i,
  );
});

test("Phase 6 stores structured operation fruit against all represented crop-cycle subjects", () => {
  assert.match(phase6, /add column if not exists result_class text/i);
  assert.match(phase6, /add column if not exists result_payload jsonb/i);
  assert.match(
    phase6,
    /create table if not exists atlas\.production_operation_actual_crop_cycles/i,
  );
  assert.match(
    phase6,
    /unique\(operation_actual_id,crop_cycle_id\)/i,
  );
  assert.match(
    phase6,
    /alter table atlas\.production_operation_actual_crop_cycles enable row level security/i,
  );
  assert.match(
    phase6,
    /create or replace function atlas\.task_reality_subject_snapshot_v1/i,
  );
});

test("Phase 6 does not expose generic Done once the domain observation boundary is installed", () => {
  assert.match(germinationAdapter, /structured_result_adapter_required/i);
  assert.match(germinationAdapter, /Generic Done is not enabled for other operations/i);
  assert.match(germinationAdapter, /domainAdapter','germination_observation_v2/i);
  for (const result of [
    "not_yet",
    "beginning",
    "germinated",
    "failed_or_uncertain",
    "problem_found",
  ]) {
    assert.match(germinationAdapter, new RegExp(result, "i"));
  }
});

test("germination fruit is written through the canonical observation command before acceptance", () => {
  const actualInsert = germinationAdapter.indexOf(
    "insert into atlas.production_operation_actuals",
  );
  const observation = germinationAdapter.indexOf(
    "atlas.record_germination_observation_for_member_v2",
  );
  const afterSnapshot = germinationAdapter.indexOf(
    "v_after := atlas.task_reality_subject_snapshot_v1",
  );
  const reclassificationGuard = germinationAdapter.indexOf(
    "if not v_reclassified then",
  );
  const doneGuard = germinationAdapter.indexOf(
    "if v_result_class='done'",
  );

  assert.ok(actualInsert >= 0);
  assert.ok(observation > actualInsert);
  assert.ok(afterSnapshot > observation);
  assert.ok(reclassificationGuard > afterSnapshot);
  assert.ok(doneGuard > reclassificationGuard);
  assert.match(
    germinationAdapter,
    /canonical germination observation did not reclassify/i,
  );
});

test("germinated is the domain observation that may close the task", () => {
  assert.match(
    germinationAdapter,
    /when v_result='germinated' then 'done'/i,
  );
  assert.match(
    germinationAdapter,
    /Germinated closes the task only inside the same transaction/i,
  );
  assert.match(
    germinationAdapter,
    /resultPayload\.spacingOutcome/i,
  );
});

test("Phase 6 preserves one labor actual even when a task has many crop-cycle subjects", () => {
  const actualInsert = germinationAdapter.match(
    /insert into atlas\.production_operation_actuals/g,
  );
  assert.equal(actualInsert?.length, 1);
  assert.match(
    germinationAdapter,
    /insert into atlas\.production_operation_actual_crop_cycles/i,
  );
  assert.match(
    germinationAdapter,
    /select v_actual\.id,link\.crop_cycle_id/i,
  );
});

test("single Production Lot resolution no longer relies on an unsupported uuid aggregate", () => {
  assert.match(singleLotFix, /if v_lot_count=1 then/i);
  assert.match(singleLotFix, /select link\.production_lot_id into v_lot_id/i);
  assert.match(singleLotFix, /replace\(v_def,v_old,v_new\)/i);
});

test("Phase 6 idempotency has its own namespace and rejects unrelated collisions", () => {
  assert.match(idempotencyFix, /re-v1:germ:/i);
  assert.match(idempotencyFix, /Idempotency key collision with a non-Phase-6 operation actual/i);
  assert.match(idempotencyFix, /worker_record_state_transition_result_v1/i);
  assert.match(idempotencyFix, /germination_observation_v2/i);
  assert.match(idempotencyFix, /domainResult/i);
});

test("Phase 6 endpoints keep the authenticated execution boundary explicit", () => {
  for (const signature of [
    "atlas.worker_state_transition_card_v2(uuid,uuid,uuid,date)",
    "atlas.worker_day_state_transition_cards_v2(uuid,uuid,date)",
    "atlas.worker_record_state_transition_result_v1(uuid,uuid,uuid,date,text,integer,text,numeric,text,text,text,jsonb)",
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(phase6, new RegExp(`revoke all on function ${escaped} from public`, "i"));
    assert.match(phase6, new RegExp(`revoke all on function ${escaped} from anon`, "i"));
    assert.match(phase6, new RegExp(`grant execute on function ${escaped} to authenticated`, "i"));
  }
});
