import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Home reads a four-slot journal cover without releasing work", () => {
  const reader = read("lib/atlas/journal-cover-home.ts");
  const page = read("app/page.tsx");

  assert.match(reader, /living_day_v1/);
  assert.match(reader, /withRole\("current"/);
  assert.match(reader, /withRole\("next"/);
  assert.match(reader, /withRole\("unlock"/);
  assert.match(reader, /withRole\("blocker"/);
  assert.match(reader, /goal\.state !== "realized"/);
  assert.match(reader, /ownerDecisions/);
  assert.match(reader, /carriedRhythms/);
  assert.doesNotMatch(reader, /insert\s+into|update\s+atlas\.|delete\s+from|\.insert\(|\.update\(|\.delete\(/i);

  assert.match(page, /readAtlasJournalCover/);
  assert.match(page, /moves: coverMoves\.map/);
  assert.doesNotMatch(page, /Current move|Next move|Closest unlock|Active blocker/);
});

test("The cover communicates roles through position and shape rather than visible labels", () => {
  const css = read("app/home-cover-v1.css");
  const layout = read("app/layout.tsx");

  assert.match(css, /nth-child\(1\)/);
  assert.match(css, /nth-child\(2\)/);
  assert.match(css, /nth-child\(3\)/);
  assert.match(css, /nth-child\(4\)/);
  assert.match(css, /> small,[\s\S]*> span,[\s\S]*> em[\s\S]*display: none !important/);
  assert.match(css, /\.atlas-task-kicker,[\s\S]*\.atlas-task-date[\s\S]*display: none !important/);
  assert.match(layout, /home-cover-v1\.css/);
});
