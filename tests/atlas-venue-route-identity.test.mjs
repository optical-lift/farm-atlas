import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const display = readFileSync(new URL("../lib/atlas/task-display.ts", import.meta.url), "utf8");

test("Venue route identity comes from structured task family signals", () => {
  assert.match(display, /function hasStructuredVenueIdentity\(task: AtlasTaskCard\)/);
  assert.match(display, /taskType === "venue"/);
  assert.match(display, /taskType\.startsWith\("venue_"\)/);
  assert.match(display, /taskType\.includes\("_venue_"\)/);
  assert.match(display, /taskType === "event_setup"/);
  assert.match(display, /taskType === "guest_readiness_round"/);
  assert.match(display, /displayFamily === "venue"/);
  assert.match(display, /operationFamily === "venue"/);
  assert.match(display, /if \(hasStructuredVenueIdentity\(task\)\) return "venue";/);
});

test("incidental venue-adjacent words cannot choose the Venue family", () => {
  assert.doesNotMatch(display, /joined\.includes\("guest"\)[^\n]*return "venue"/);
  assert.doesNotMatch(display, /joined\.includes\("clean"\)[^\n]*return "venue"/);
  assert.doesNotMatch(display, /joined\.includes\("wash"\)[^\n]*return "venue"/);
  assert.doesNotMatch(display, /joined\.includes\("window"\)[^\n]*return "venue"/);
  assert.doesNotMatch(display, /joined\.includes\("venue"\)[^\n]*return "venue"/);
});
