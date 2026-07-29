import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day task titles open the full task while the caret keeps the reveal", () => {
  const patch = read("app/DayTaskTitleLinkPatch.tsx");
  const css = read("app/day-task-title-link.css");
  const layout = read("app/layout.tsx");

  assert.match(patch, /atlas-journal-task-row > summary > strong/);
  assert.match(patch, /atlas-journal-task-detail > a\[href\]/);
  assert.match(patch, /event\.preventDefault\(\)/);
  assert.match(patch, /window\.location\.assign\(link\.href\)/);
  assert.match(patch, /role", "link"/);
  assert.match(patch, /tabIndex = 0/);
  assert.doesNotMatch(patch, /atlas-journal-row-caret/);
  assert.match(css, /atlas-journal-row-caret/);
  assert.match(layout, /<DayTaskTitleLinkPatch \/>/);
});
