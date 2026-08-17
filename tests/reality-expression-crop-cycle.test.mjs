import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260817211627_reality_expression_crop_cycle_packet_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

const functionBody = migration.match(
  /create or replace function atlas\.crop_cycle_reality_expression_v1[\s\S]*?\$function\$;/,
)?.[0];

assert.ok(functionBody, "Reality Expression function body must be present");

test("Pass 1 is a read-only service-internal contract", () => {
  assert.match(migration, /crop_cycle_reality_expression_v1\(p_crop_cycle_id uuid\)/);
  assert.match(migration, /stable\s+security invoker/i);
  assert.match(
    migration,
    /revoke all on function atlas\.crop_cycle_reality_expression_v1\(uuid\) from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant execute on function atlas\.crop_cycle_reality_expression_v1\(uuid\) to service_role;/,
  );
  assert.match(migration, /'service_internal'/);
  assert.match(
    migration,
    /authenticated_execute_expected,[\s\S]*security_definer_expected,[\s\S]*service_execute_expected/,
  );
  assert.match(migration, /false,\s*false,\s*true,\s*0,\s*0,/);

  assert.doesNotMatch(functionBody, /\binsert\s+into\b/i);
  assert.doesNotMatch(functionBody, /\bupdate\s+atlas\./i);
  assert.doesNotMatch(functionBody, /\bdelete\s+from\b/i);
  assert.doesNotMatch(functionBody, /\bperform\s+atlas\./i);
});

test("the packet keeps the Reality Expression layers distinct", () => {
  for (const key of [
    "subject",
    "source",
    "witnesses",
    "flowBuffer",
    "claims",
    "fittingOperation",
    "jurisdiction",
    "continuity",
    "issues",
  ]) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
});

test("historical and canonical timing witnesses are preserved rather than flattened", () => {
  assert.match(migration, /historicalTaskProjection/);
  assert.match(migration, /canonicalCycleExpectation/);
  assert.match(migration, /conflicting_witnesses/);
  assert.match(migration, /conflicting_germination_witnesses/);
  assert.match(migration, /operativeContractSource/);
  assert.match(migration, /active_germination_rhythm/);
});

test("unknown quantity stays unknown when the crop cycle has no recorded coverage", () => {
  assert.match(migration, /when v_cycle\.coverage_amount is not null/);
  assert.match(
    migration,
    /jsonb_build_object\('value', null, 'unit', null, 'kind', null, 'status', 'unknown'\)/,
  );
});

test("shared bed occupancy requests relation evidence without inventing a conflict", () => {
  assert.match(migration, /activeCoOccupants/);
  assert.match(migration, /relation_evidence_required/);
  assert.match(migration, /active_shared_destination_requires_relation_evidence/);
  assert.match(
    migration,
    /does not infer conflict or lawful co-occupancy; the relationship remains unresolved/,
  );
});

test("missing planting and Production Lot links remain typed gaps, not erasure of crop truth", () => {
  assert.match(migration, /missing_planting_claim/);
  assert.match(migration, /physical_subject_recorded_without_planting_claim/);
  assert.match(migration, /no_production_lot_provenance/);
  assert.match(
    migration,
    /The current crop remains valid crop-cycle truth; this is an architecture\/provenance gap/,
  );
});

test("a lawful future rhythm gate is continuity even when no task is currently released", () => {
  assert.match(migration, /when v_rhythm_current_task_id is not null then 'released_operation_present'/);
  assert.match(migration, /else 'future_gate_present'/);
  assert.match(migration, /'silentNothing', \(v_continuity_state = 'unresolved'\)/);
  assert.match(migration, /living_subject_without_known_continuation/);
});

test("operation fitness comes from the active biological rhythm rather than task volume", () => {
  assert.match(migration, /state\.rhythm_key = 'germination_watch'/);
  assert.match(migration, /'operationClass', 'observe_germination'/);
  assert.match(migration, /then 'not_yet'/);
  assert.match(migration, /then 'available'/);
  assert.match(migration, /then 'required'/);
  assert.match(migration, /then 'failure_boundary_crossed'/);
  assert.match(migration, /'carrierStatus'.*'not_assigned_until_release'/s);
});
