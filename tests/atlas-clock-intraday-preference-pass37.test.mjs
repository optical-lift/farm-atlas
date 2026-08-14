import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const mobility = read("lib/atlas/timing-mobility.ts");
const proposal = read("lib/atlas/clock-proposal.ts");
const sequence = read("lib/atlas/day-sequence.ts");

test("Pass 37 promotes only the known intraday preference into typed Worker Day timing truth", () => {
  assert.match(mobility, /export type AtlasIntradayWorkPreference = "cool_morning_or_evening"/);
  assert.match(mobility, /intradayPreference\?: AtlasIntradayWorkPreference \| null/);
  assert.match(mobility, /intradayPreference\(metadata\.preferred_window\)/);
  assert.match(mobility, /text\(value\) === "cool_morning_or_evening" \? "cool_morning_or_evening" : null/);
  assert.match(mobility, /intradayPreference: preferredIntradayWindow/);
});

test("Clock consumes the typed projection field rather than reading arbitrary task metadata", () => {
  assert.match(proposal, /item\.mobility\.intradayPreference/);
  assert.doesNotMatch(proposal, /metadata\.preferred_window/);
  assert.doesNotMatch(proposal, /metadata\s*\[/);
});

test("cool-morning-or-evening is a soft flexible-work search order with midday fallback", () => {
  assert.match(proposal, /if \(item\.mobility\.intradayPreference !== "cool_morning_or_evening"\) return \[item\.dayWindow\]/);
  assert.match(proposal, /\["evening", "morning"\]/);
  assert.match(proposal, /\["morning", "evening"\]/);
  assert.match(proposal, /\["morning", "afternoon", "evening"\]/);
  assert.match(proposal, /firstFlexibleFree\(item, duration\.minutes, reservations\)/);
  assert.match(proposal, /firstFree\(bounds\.start, bounds\.end, duration, reservations\)/);
  assert.match(proposal, /No preferred cool-work span fit/);
});

test("hard timing constraints and real reservations still outrank the soft preference", () => {
  const fixed = proposal.indexOf('mobility.constraintClass === "fixed"');
  const windowed = proposal.indexOf('mobility.constraintClass === "windowed"');
  const flexible = proposal.indexOf("const placement = firstFlexibleFree");
  const anchored = proposal.indexOf('constraintClass === "anchored"');
  assert.ok(fixed >= 0 && windowed > fixed && flexible > windowed && anchored >= 0);
  assert.match(proposal, /conflictsAny\(start, start \+ duration\.minutes, reservations\)/);
  assert.match(proposal, /atlasClockReservationConflicts/);
  assert.match(proposal, /anchorRange/);
});

test("biological date windows remain separate from intraday Clock preference", () => {
  for (const field of ["preferredWindowStart", "preferredWindowEnd", "safeWindowEnd"]) assert.match(sequence, new RegExp(field));
  assert.doesNotMatch(proposal, /preferredWindowStart|preferredWindowEnd|safeWindowEnd/);
  assert.doesNotMatch(mobility, /preferredWindowStart|preferredWindowEnd|safeWindowEnd/);
});
