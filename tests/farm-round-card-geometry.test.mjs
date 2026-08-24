import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const component = fs.readFileSync("components/atlas/farm-round-task-detail.tsx", "utf8");
const styles = fs.readFileSync("components/atlas/farm-round-task-detail.module.css", "utf8");

test("Farm Round owns its specialized body instead of borrowing Venue rail geometry", () => {
  assert.doesNotMatch(component, /task-card-venue-rail/);
  assert.match(component, /data-atlas-farm-round="canonical-card-geometry-v1"/);
  assert.match(component, /className=\{roundStyles\.stop\}/);
  assert.match(component, /className=\{roundStyles\.item\}/);
});

test("Farm Round obeys the canonical Task Focus card width and section spacing", () => {
  assert.match(styles, /width:\s*min\(100%,\s*520px\)/);
  assert.match(styles, /padding:\s*17px 18px 17px 64px/);
  assert.match(styles, /font-size:\s*20px/);
  assert.match(styles, /font-size:\s*13px/);
});
