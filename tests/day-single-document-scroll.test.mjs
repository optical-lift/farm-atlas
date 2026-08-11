import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const dayScroll = read("app/day-single-scroll.css");
const overflowGuard = read("app/mobile-overflow-guard.css");

test("Living Day keeps one document-level vertical scroll even with the mobile overflow guard", () => {
  assert.match(overflowGuard, /overflow-x: hidden !important/);
  assert.match(dayScroll, /overflow-x: clip !important/);
  assert.match(dayScroll, /overflow-y: visible !important/);
  assert.match(dayScroll, /body:has\(\.atlas-day-browse\) \.atlas-day-task-groups/);
  assert.match(dayScroll, /body:has\(\.atlas-day-browse\) \.atlas-day-work-order-list/);
  assert.match(dayScroll, /body:has\(\.atlas-day-browse\) \.atlas-day-route-spine/);
  assert.doesNotMatch(dayScroll, /overflow-y: auto !important/);
});

test("the Day timeline spine keeps its connector without becoming a scroll container", () => {
  assert.match(dayScroll, /body:has\(\.atlas-day-browse\) \.atlas-day-route-spine \{[\s\S]*position: relative !important/);
  assert.match(dayScroll, /\.atlas-day-route-spine \{[\s\S]*overflow-x: clip !important;[\s\S]*overflow-y: visible !important/);
  assert.match(dayScroll, /-webkit-overflow-scrolling: auto !important/);
  assert.match(dayScroll, /scroll-snap-type: none !important/);
});
