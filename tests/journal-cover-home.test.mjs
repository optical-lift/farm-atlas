import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the legacy journal cover remains a read-only lens while Home uses the prepared task overview", () => {
  const reader = read("lib/atlas/journal-cover-home.ts");
  const operatorReader = read("lib/atlas/operator-journal-cover.ts");
  const overviewReader = read("lib/atlas/home-task-overview.ts");
  const page = read("app/page.tsx");

  assert.match(reader, /living_day_v1/);
  assert.match(reader, /withRole\("current"/);
  assert.match(reader, /withRole\("next"/);
  assert.match(reader, /withRole\("unlock"/);
  assert.match(reader, /withRole\("blocker"/);
  assert.match(reader, /entry\.state !== "realized"/);
  assert.match(reader, /ownerDecisions/);
  assert.match(reader, /carriedRhythms/);
  assert.doesNotMatch(reader, /insert\s+into|update\s+atlas\.|delete\s+from|\.insert\(|\.update\(|\.delete\(/i);

  assert.match(operatorReader, /readAtlasJournalCover/);
  assert.match(operatorReader, /ownerDecisions: \[\]/);
  assert.match(overviewReader, /livingDay\.journal\.planned/);
  assert.match(page, /readAtlasOperatorHomeTaskOverview/);
  assert.match(page, /moves: taskOverview\.moves/);
  assert.doesNotMatch(page, /readAtlasOperatorJournalCover/);
});

test("The legacy four-box journal lens still speaks in bullet-journal marks and farm-state movement", () => {
  const reader = read("lib/atlas/journal-cover-home.ts");

  assert.match(reader, /current: "●"/);
  assert.match(reader, /next: "○"/);
  assert.match(reader, /unlock: "~"/);
  assert.match(reader, /blocker: "!"/);
  assert.match(reader, /Return the row to production/);
  assert.match(reader, /Continue the recovery block/);
  assert.match(reader, /Emergence will confirm the stand/);
  assert.match(reader, /Clearance \+ approval hold the block/);
  assert.match(reader, /category: coverMark\[role\]/);
});

test("The legacy cover CSS remains available for journal surfaces without styling Home", () => {
  const css = read("app/home-cover-v1.css");
  const layout = read("app/layout.tsx");

  assert.match(css, /grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(css, /> small \{[\s\S]*grid-column: 1;[\s\S]*grid-row: 1;/);
  assert.match(css, /> strong \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 1;/);
  assert.match(css, /> em \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*grid-row: 2;/);
  assert.match(css, /> span \{[\s\S]*display: none !important/);
  assert.match(css, /::before,[\s\S]*::after[\s\S]*content: none !important/);
  assert.match(css, /nth-child\(1\)/);
  assert.match(css, /nth-child\(2\)/);
  assert.match(css, /nth-child\(3\)/);
  assert.match(css, /nth-child\(4\)/);
  assert.match(css, /nth-child\(-n \+ 2\)\[data-atlas-state="attention"\]/);
  assert.match(css, /background: var\(--atlas-purple-dark\) !important/);
  assert.match(css, /\.atlas-task-kicker,[\s\S]*\.atlas-task-date[\s\S]*display: none !important/);
  assert.match(layout, /home-cover-v1\.css/);
  assert.doesNotMatch(layout, /home-task-overview\.css/);
});
