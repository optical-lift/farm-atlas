import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }
const gate = read("components/atlas/owner-day-plan-gate.tsx");
const grammar = read("components/atlas/owner-day-visual-grammar.tsx");
const projection = read("components/atlas/owner-interleaved-day-projection.tsx");

test("Owner Day declares one visual grammar for committed work, potential work, and cues", () => {
  assert.match(gate, /OwnerDayVisualGrammar/);
  assert.match(gate, /<OwnerInterleavedDayProjection planningActive=\{open\} \/>\s*<OwnerDayVisualGrammar \/>/);
  assert.match(grammar, /data-owner-day-visual-grammar="committed-white potential-purple cue-interruption"/);
  assert.match(grammar, /COMMITTED — real work already in the working Day/);
  assert.match(grammar, /POTENTIAL — an Owner planning branch/);
  assert.match(grammar, /CUE — crosses the chronology/);
});

test("potential work stays purple and branches off the uninterrupted Day rail", () => {
  assert.match(projection, /ownerDaySequenceKind = item\.kind/);
  assert.match(grammar, /data-owner-day-sequence-kind="potential_task"/);
  assert.match(grammar, /atlas-owner-potential-day-card::before/);
  assert.match(grammar, /border-top: 1px dashed/);
  assert.match(grammar, /atlas-owner-potential-day-card\[data-selected="true"\]/);
});

test("cues read as chronological interruptions rather than another rounded task card", () => {
  assert.match(grammar, /data-owner-day-sequence-kind="cue"/);
  assert.match(grammar, /atlas-owner-day-cue-marker::before/);
  assert.match(grammar, /border-radius: 0/);
  assert.match(grammar, /background: transparent/);
  assert.match(grammar, /transform: rotate\(45deg\)/);
});
