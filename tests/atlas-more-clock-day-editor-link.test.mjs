import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const more = readFileSync(new URL("../app/more/page.tsx", import.meta.url), "utf8");

test("owner More navigation exposes the Clock Day design lab", () => {
  assert.match(more, /label: "Clock \+ Day Editor"/);
  assert.match(more, /href: "\/owner\/clock-day-lab"/);
  assert.match(more, /Redesign the merged worker Clock, timeline and Day Feed experience/);
});

test("Clock Day Editor remains inside the owner-only destination block", () => {
  assert.match(more, /\.\.\.\(isFarmOwner \? \[[\s\S]*Clock \+ Day Editor[\s\S]*\] : \[\]\)/);
});
