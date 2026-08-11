import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const builder = read("components/atlas/owner-day-schedule-builder.tsx");
const server = read("lib/atlas/worker-day-plan-server.ts");

test("Owner Day Edit supports rewindowing, ordering, tomorrow, next week, date picking, and Return to Atlas", () => {
  assert.match(builder, /draggable/);
  assert.match(builder, /moveWindow/);
  assert.match(builder, /reorderBefore/);
  assert.match(builder, />Tomorrow<\/button>/);
  assert.match(builder, />Next week<\/button>/);
  assert.match(builder, /type="date"/);
  assert.match(builder, />Return to Atlas<\/button>/);
  assert.match(builder, /return_to_atlas/);
  assert.match(builder, /Commit \$\{dirtyCount\}/);
});

test("canonical timing truth can warn before Owner pushes work outside its useful window", () => {
  assert.match(server, /preferredWindowStart/);
  assert.match(server, /preferredWindowEnd/);
  assert.match(server, /safeWindowEnd/);
  assert.match(server, /commitment_kind === "hard_date"/);
  assert.match(server, /Moving this may miss the preferred pot-up window/);
  assert.match(builder, /data-owner-day-timing-warning="true"/);
  assert.match(builder, />Keep today<\/button>/);
  assert.match(builder, />Move anyway<\/button>/);
  assert.match(builder, /requestDateMove/);
  assert.match(builder, /serviceDate > row\.safeWindowEnd/);
});

test("a timing warning blocks commit until Owner explicitly chooses", () => {
  assert.match(builder, /if \(!dateIso \|\| saving \|\| pendingMove/);
  assert.match(builder, /disabled=\{!dirtyCount \|\| saving \|\| Boolean\(pendingMove\)\}/);
  assert.match(builder, /Resolve move warning/);
});
