import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const intakeMigrationName =
  "20260817224818_reality_expression_neutral_relation_witness_intake_v1.sql";
const hardeningMigrationName =
  "20260817230206_reality_expression_neutral_relation_witness_hardening_v1.sql";

const intake = readFileSync(
  new URL(`../supabase/migrations/${intakeMigrationName}`, import.meta.url),
  "utf8",
);
const hardening = readFileSync(
  new URL(`../supabase/migrations/${hardeningMigrationName}`, import.meta.url),
  "utf8",
);

const intakeFunction = intake.match(
  /create or replace function atlas\.record_crop_relation_evidence_v1[\s\S]*?\$function\$;/,
)?.[0];
const witnessProjection = intake.match(
  /create or replace function atlas\.crop_cycle_relation_witness_evidence_v1[\s\S]*?\$function\$;/,
)?.[0];
const hardenedIntakeFunction = hardening.match(
  /create or replace function atlas\.record_crop_relation_evidence_v1[\s\S]*?\$function\$;/,
)?.[0];
const hardenedResolution = hardening.match(
  /create or replace function atlas\.crop_cycle_relation_resolution_requirements_v2[\s\S]*?\$function\$;/,
)?.[0];

assert.ok(intakeFunction, "Neutral relation witness intake function must exist");
assert.ok(witnessProjection, "Neutral witness projection must exist");
assert.ok(hardenedIntakeFunction, "Hardened neutral witness intake function must exist");
assert.ok(hardenedResolution, "Hardened resolution projection must exist");

test("neutral witness intake is authenticated human evidence, not service impersonation", () => {
  assert.match(intake, /security definer/i);
  assert.match(
    intake,
    /grant execute on function atlas\.record_crop_relation_evidence_v1\(uuid,text,text,jsonb,date,text,text\) to authenticated;/i,
  );
  assert.match(
    intake,
    /revoke execute on function atlas\.record_crop_relation_evidence_v1\(uuid,text,text,jsonb,date,text,text\) from anon;/i,
  );
  assert.match(
    intake,
    /revoke execute on function atlas\.record_crop_relation_evidence_v1\(uuid,text,text,jsonb,date,text,text\) from service_role;/i,
  );
  assert.match(intakeFunction, /v_actor_user_id := auth\.uid\(\);/);
  assert.match(intakeFunction, /Active farm membership required/);
});

test("neutral witness intake appends evidence without using the lifecycle-mutating observation command", () => {
  assert.match(intakeFunction, /insert into atlas\.crop_occupancy_evidence/i);
  assert.match(intakeFunction, /'evidenceClass', 'relation_witness'/);
  assert.match(intakeFunction, /'neutral', true/);
  assert.match(intakeFunction, /'adjudicated', false/);
  assert.doesNotMatch(intakeFunction, /record_crop_observation_for_member_v1/i);
  assert.doesNotMatch(intakeFunction, /update\s+atlas\.crop_cycles/i);
  assert.doesNotMatch(intakeFunction, /delete\s+from\s+atlas\./i);
});

test("witness projection remains read-only and service-internal", () => {
  assert.match(intake, /stable\s+security invoker/i);
  assert.match(
    intake,
    /grant execute on function atlas\.crop_cycle_relation_witness_evidence_v1\(uuid\) to service_role;/i,
  );
  assert.match(
    intake,
    /revoke execute on function atlas\.crop_cycle_relation_witness_evidence_v1\(uuid\) from authenticated;/i,
  );
  assert.doesNotMatch(witnessProjection, /\binsert\s+into\b/i);
  assert.doesNotMatch(witnessProjection, /\bupdate\s+atlas\./i);
  assert.doesNotMatch(witnessProjection, /\bdelete\s+from\b/i);
  assert.match(witnessProjection, /'automaticAdjudication', false/);
  assert.match(witnessProjection, /'automaticCropStateMutation', false/);
  assert.match(witnessProjection, /'automaticSpatialMutation', false/);
});

test("idempotency is scoped to the witnessing membership", () => {
  assert.ok(intakeMigrationName < hardeningMigrationName);
  assert.match(
    hardening,
    /\(metadata ->> 'witnessMembershipId'\)[\s\S]*?\(metadata ->> 'idempotencyKey'\)/,
  );
  assert.match(
    hardenedIntakeFunction,
    /evidence\.metadata ->> 'witnessMembershipId' = v_membership_id::text/,
  );
});

test("an idempotency key replays only the exact semantic witness request", () => {
  for (const field of [
    "requirementKey",
    "observedResult",
    "targetCropCycleId",
    "payload",
    "evidenceDate",
    "confidence",
  ]) {
    assert.ok(hardenedIntakeFunction.includes(`'${field}'`));
  }
  assert.match(hardenedIntakeFunction, /'request', v_request/);
  assert.match(hardenedIntakeFunction, /if v_existing_request <> v_request then/);
  assert.match(
    hardenedIntakeFunction,
    /Idempotency key already belongs to a different relation witness request/,
  );
  assert.match(hardenedIntakeFunction, /'idempotentReplay', true/);
});

test("owner confirmation cannot be claimed by a non-owner witness", () => {
  assert.match(
    hardenedIntakeFunction,
    /if p_confidence = 'owner_confirmed' and v_role <> 'owner' then/,
  );
  assert.match(
    hardenedIntakeFunction,
    /Only an owner membership may submit owner_confirmed evidence/,
  );
  assert.match(hardenedResolution, /'ownerConfirmedBoundary','owner membership only'/);
});

test("conflict language does not invent multiple witnesses", () => {
  assert.match(
    hardenedResolution,
    /Neutral witness evidence contains conflicting present\/absent observations/,
  );
  assert.doesNotMatch(
    hardenedResolution,
    /Two or more neutral witnesses supplied conflicting/,
  );
  assert.match(hardenedResolution, /does not adjudicate it automatically/);
});

test("Reality Expression v4 exposes witness evidence without forced completeness", () => {
  assert.match(
    intake,
    /v_base := atlas\.crop_cycle_reality_expression_v2\(p_crop_cycle_id\);/,
  );
  assert.match(
    intake,
    /v_resolution := atlas\.crop_cycle_relation_resolution_requirements_v2\(p_crop_cycle_id\);/,
  );
  assert.match(intake, /'contractVersion','crop_cycle_reality_expression_v4'/);
  assert.match(intake, /'relation_witness_evidence_pending_adjudication'/);
  assert.match(intake, /'conflicting_relation_witness_evidence'/);
});
