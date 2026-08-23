import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260823024155_research_attempt_write_membrane_v1.sql", import.meta.url),
  "utf8",
);

const writer = migration.match(
  /create or replace function local_intel\.record_research_attempt_v1\(p_payload jsonb\)[\s\S]*?\nend;\$\$;/i,
)?.[0] ?? "";

test("research attempts gain a stable idempotency key", () => {
  assert.match(migration, /add column if not exists attempt_key text/i);
  assert.match(migration, /unique index if not exists research_attempts_attempt_key_uidx/i);
});

test("research attempt history becomes append-only", () => {
  assert.match(migration, /block_research_attempt_mutation_v1/i);
  assert.match(migration, /before update or delete on local_intel\.research_attempts/i);
  assert.match(migration, /research attempts are append-only/i);
});

test("writer resolves only an active governed research question", () => {
  assert.match(writer, /research_questions where stable_key=/i);
  assert.match(writer, /status='active'/i);
  assert.match(writer, /active research question is required/i);
});

test("writer preserves controlled outcome and evidence-effect vocabularies", () => {
  for (const outcome of ["evidence_found", "no_qualifying_public_evidence", "ambiguous", "source_unavailable", "blocked", "not_applicable"]) {
    assert.ok(writer.includes(`'${outcome}'`));
  }
  for (const effect of ["advance", "defer", "deprioritize", "no_change"]) {
    assert.ok(writer.includes(`'${effect}'`));
  }
});

test("writer requires attributable summary and source scope", () => {
  assert.match(writer, /finding_summary and source_scope are required/i);
  assert.match(writer, /sources_checked/i);
  assert.match(writer, /queries_checked/i);
});

test("idempotent replay cannot mutate an existing attempt", () => {
  assert.match(writer, /where attempt_key=v_key/i);
  assert.match(writer, /already belongs to different immutable research attempt/i);
});

test("research kind and question text come from the governed question registry", () => {
  assert.match(writer, /select research_kind, question_text into v_kind,v_question_text/i);
  assert.match(writer, /v_kind,v_question_text,v_question/i);
});

test("service role writes only through the function", () => {
  assert.match(migration, /grant execute on function local_intel\.record_research_attempt_v1\(jsonb\) to service_role/i);
  assert.match(migration, /revoke all on local_intel\.research_attempts from public,anon,authenticated,service_role/i);
  assert.match(migration, /grant select on local_intel\.research_attempts to service_role/i);
  assert.match(migration, /revoke all on function local_intel\.block_research_attempt_mutation_v1\(\) from public,anon,authenticated,service_role/i);
});