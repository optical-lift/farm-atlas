import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260820001516_p6_principal_clock_requirement_acquisition_v1.sql",
  "utf8",
);

test("P6 projects the existing truth-acquisition carrier directly into Principal Clock", () => {
  assert.match(sql, /principal_requirement_acquisition_clock_candidates_v1/);
  assert.match(sql, /'requirement_truth_acquisition'::text as source_type/);
  assert.match(sql, /t\.id as source_id/);
  assert.match(sql, /acq\.consequence_role='truth_acquisition'/);
  assert.match(sql, /req\.consequence_role='operation_requirement'/);
  assert.match(sql, /t\.id=acq\.carrier_task_id/);
  assert.match(sql, /FROM atlas\.principal_requirement_acquisition_clock_candidates_v1 c/i);
});

test("P6 preserves requirement time independently of human scheduling", () => {
  assert.match(sql, /when req\.requirement_onset_date is not null/);
  assert.match(sql, /when req\.requirement_known_active_by is not null/);
  assert.match(sql, /else acq\.released_at/);
  assert.match(sql, /null::timestamptz as must_begin_by/);
  assert.match(sql, /'requirementClockIndependentOfPlacement',true/);
  assert.match(sql, /'gapResolutionDoesNotResetRequirementClock',true/);
  assert.match(sql, /'knownActiveByIsNotClaimedAsExactOnset'/);
  assert.doesNotMatch(sql, /update\s+atlas\.state_consequence_instances/i);
});

test("P6 does not duplicate the human move into another Owner obligation or escalation", () => {
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.owner_obligations/i);
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.operational_escalations/i);
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.tasks/i);
  assert.match(sql, /'clockProjectionCreatesNoDuplicateOwnerObligation',true/);
  assert.match(sql, /'taskIsCarrierNotRequirement',true/);
});

test("P6 can clock gap resolution before physical execution is released", () => {
  assert.match(sql, /'clockCandidateRole','gap_resolution'/);
  assert.match(sql, /'physicalExecutionMayRemainUnreleased',true/);
  assert.match(sql, /and t\.visibility_scope='owner'/);
  assert.match(sql, /and fm\.role='owner'/);
  assert.doesNotMatch(sql, /worker_day_task_placements/);
  assert.doesNotMatch(sql, /action_key\s*=\s*'transplant'/i);
});

test("P6 keeps the requirement-acquisition Clock projection service-internal", () => {
  assert.match(
    sql,
    /revoke all on atlas\.principal_requirement_acquisition_clock_candidates_v1 from public,anon,authenticated/,
  );
  assert.match(
    sql,
    /grant select on atlas\.principal_requirement_acquisition_clock_candidates_v1 to service_role/,
  );
});
