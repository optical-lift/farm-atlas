import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const editor = read("components/atlas/owner-day-cue-editor.tsx");
const migration = read("supabase/migrations/20260811190000_atlas_owner_cue_edit_preserves_result_contract_v1.sql");

test("Owner can re-anchor cues by tap or drag without making them tasks", () => {
  assert.match(editor, /Show this cue/);
  assert.match(editor, /Morning login/);
  assert.match(editor, /Before a task/);
  assert.match(editor, /After a task/);
  assert.match(editor, /draggable=\{canDrag\}/);
  assert.match(editor, /data-cue-reanchor-targets="true"/);
  assert.match(editor, /reanchorCue/);
  assert.match(editor, /Drop “\{draggingCue.title\}” onto its new task/);
  assert.doesNotMatch(editor, /task_transition|task_outcome/i);
});

test("editing a generated operational cue preserves its full payload and result contract", () => {
  assert.match(editor, /payload: \{ \.\.\.cue\.payload \}/);
  assert.match(editor, /const cuePayload: Record<string, unknown> = \{ \.\.\.draft\.payload \}/);
  assert.match(migration, /v_has_result_contract:=p_cue \? 'resultContract'/);
  assert.match(migration, /result_contract=case when v_has_result_contract then v_result_contract else cue\.result_contract end/);
});
