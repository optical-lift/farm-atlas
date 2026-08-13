import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const builder = read("components/atlas/owner-day-schedule-builder.tsx");
const projection = read("components/atlas/owner-interleaved-day-projection.tsx");
const server = read("lib/atlas/worker-day-plan-server.ts");

test("Owner Day Edit manipulates the real Day cards instead of rendering a second schedule board", () => {
  assert.match(builder, /createPortal/);
  assert.match(builder, /data-owner-day-inline-edit-controller/);
  assert.match(builder, /data-owner-day-inline-controls/);
  assert.match(builder, /applyDraftLayout/);
  assert.match(builder, /moveWindow/);
  assert.match(builder, /bump/);
  assert.match(builder, /Tomorrow/);
  assert.match(builder, /type="date"/);
  assert.match(builder, /Return to Atlas/);
  assert.match(builder, /return_to_atlas/);
  assert.match(builder, /Commit day/);
  assert.doesNotMatch(builder, /data-owner-day-edit-board/);
});

test("purple potential is selected or set aside where Atlas projected it", () => {
  assert.match(projection, /atlas-owner-day-potential-toggle/);
  assert.match(projection, /Will add/);
  assert.match(projection, /Not today/);
  assert.match(builder, /selectedCandidates/);
  assert.match(builder, /selections: selectedCandidates/);
});

test("draft reordering and task-anchored cues share the same live Day geometry", () => {
  assert.match(builder, /ownerDraftWindow/);
  assert.match(builder, /ownerDraftOrder/);
  assert.match(builder, /atlas-owner-day-draft-layout/);
  assert.match(projection, /effectivePlacement/);
  assert.match(projection, /anchorTaskId/);
  assert.match(projection, /insertAdjacentElement/);
});

test("closing planning can restore the uncommitted baseline", () => {
  assert.match(builder, /applyDraftLayout\(timeline, baseline, dateIso, automaticWork\)/);
  assert.match(builder, /removeMovedOffHost/);
  assert.match(builder, /atlas-owner-day-draft-reset/);
});

test("canonical timing truth can warn before Owner pushes work outside its useful window", () => {
  assert.match(server, /preferredWindowStart/);
  assert.match(server, /preferredWindowEnd/);
  assert.match(server, /safeWindowEnd/);
  assert.match(server, /commitment_kind === "hard_date"/);
  assert.match(server, /Moving this may miss the preferred pot-up window/);
  assert.match(builder, /data-owner-day-timing-warning/);
  assert.match(builder, /Keep current/);
  assert.match(builder, /Move anyway/);
  assert.match(builder, /requestDateMove/);
  assert.match(builder, /serviceDate > row\.safeWindowEnd/);
});

test("a timing warning blocks commit until Owner explicitly chooses", () => {
  assert.match(builder, /pendingMove/);
  assert.match(builder, /disabled=\{!dirtyCount \|\| saving \|\| Boolean\(pendingMove\)\}/);
  assert.match(builder, /Resolve warning/);
});
