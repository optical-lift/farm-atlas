import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day task access is rendered by the Day card instead of patched onto its title", () => {
  const page = read("app/day/page.tsx");
  const css = read("app/day-task-title-link.css");
  const layout = read("app/layout.tsx");

  assert.equal(existsSync(new URL("../app/DayTaskTitleLinkPatch.tsx", import.meta.url)), false);
  assert.doesNotMatch(layout, /DayTaskTitleLinkPatch/);
  assert.match(page, /className="atlas-journal-task-detail"/);
  assert.match(page, /<Link href=\{taskHref\(task, returnTo\)\}>Open full task/);
  assert.match(page, /atlas-journal-row-caret/);
  assert.match(css, /atlas-journal-row-caret/);
  assert.doesNotMatch(page, /window\.location\.assign\(link\.href\)/);
});
