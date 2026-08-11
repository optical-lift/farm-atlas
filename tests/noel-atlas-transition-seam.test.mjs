import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260811192000_atlas_noel_transition_context_seam_v1.sql");
const server = read("lib/atlas/noel-transition-context-server.ts");
const cueEditor = read("components/atlas/owner-day-cue-editor.tsx");

test("Atlas exposes the transition context Noel will eventually use for candidate generation", () => {
  assert.match(migration, /taskContext/);
  assert.match(migration, /physicalLoad/);
  assert.match(migration, /projectContext/);
  assert.match(migration, /beforeState/);
  assert.match(migration, /intendedAfter/);
  assert.match(migration, /completionMeaning/);
  assert.match(migration, /transitionType/);
  assert.match(server, /owner_task_noel_transition_context_api_v1/);
});

test("the Noel seam is Owner-only and does not make somatic selection farm-state evidence", () => {
  assert.match(migration, /fm\.role='owner'/);
  assert.match(migration, /atlasOwnsFarmPriority/);
  assert.match(migration, /noelCandidateSelectionIsOwnerMediated/);
  assert.match(migration, /somaticSelectionIsNotFarmStateEvidence/);
  assert.match(migration, /worker_day_cues:cue_kind=somatic/);
  assert.doesNotMatch(migration, /update atlas\.tasks\s+set priority/i);
  assert.match(cueEditor, /\+ Somatic after/);
});
