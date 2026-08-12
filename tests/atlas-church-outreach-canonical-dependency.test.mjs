import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812014500_church_outreach_canonical_dependency_v1.sql", import.meta.url),
  "utf8",
);
const normalized = migration.replace(/\s+/g, " ").trim();

test("church batch 2 is released by canonical task prerequisites", () => {
  assert.match(migration, /network_20260725_call_10_churches/);
  assert.match(migration, /anna_20260812_church_outreach_batch_2/);
  assert.match(normalized, /insert into atlas\.task_prerequisites\( farm_id,downstream_task_id,prerequisite_task_id,required_status,hold_mode,sequence_order,active,metadata \)/);
  assert.match(migration, /'done','blocked_visible',10,true/);
  assert.match(migration, /batch_1_completes_before_batch_2/);
});

test("all five batch-2 checklist contacts inherit the same real prerequisite", () => {
  assert.match(migration, /if v_child_count<>5 then/);
  assert.match(migration, /child\.parent_task_id=v_next\.id/);
  assert.match(migration, /child\.task_type='checklist_step'/);
  assert.match(migration, /batch_1_completes_before_batch_2_contact/);
});

test("the prerequisite gate restores batch 2 and contacts to open, not permanently blocked", () => {
  assert.match(migration, /set status='open',\s*blocker_text=null/);
  assert.match(migration, /'prerequisite_waiting_text','Finish the first five church contacts first\.'/);
  assert.match(migration, /'prerequisite_waiting_text','Waiting for the first church outreach batch\.'/);
  const checklistOpenWrites = migration.match(/'\{checklist_status\}'[\s\S]{0,80}'"open"'::jsonb/g) ?? [];
  assert.ok(checklistOpenWrites.length >= 2, "both canonical seeding and legacy compatibility must restore child checklist_status to open");
});

test("legacy release endpoint becomes idempotent once canonical prerequisite truth exists", () => {
  assert.match(migration, /create or replace function atlas\.release_network_outreach_batch_v1/);
  assert.match(migration, /v_has_canonical_prerequisite/);
  assert.match(migration, /perform atlas\.reconcile_task_prerequisite_gate_v1\(v_next\.id,now\(\)\)/);
  assert.match(migration, /'releaseSource','canonical_prerequisite'/);
  assert.match(migration, /'alreadyReleased',v_next\.status in \('open','done'\)/);
});

test("legacy compatibility cannot bypass an incomplete current batch", () => {
  assert.match(migration, /if v_source\.status is distinct from 'done' then/);
  assert.match(migration, /Finish the current outreach batch before releasing the next one\./);
});

test("migration uses stable task keys instead of generated task ids", () => {
  assert.doesNotMatch(migration, /9884ea02-4f6a-42ad-b8e3-9d58349dd38b/i);
  assert.doesNotMatch(migration, /0e0d97a4-1a52-479f-bced-05aeaf83e96b/i);
});

test("release function keeps its existing authenticated privilege surface", () => {
  assert.match(migration, /security definer/);
  assert.doesNotMatch(migration, /\bgrant\s+execute\b/i);
  assert.doesNotMatch(migration, /\brevoke\s+all\s+on\s+function\s+atlas\.release_network_outreach_batch_v1/i);
});
