import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const layout = read("app/layout.tsx");
const fixes = read("app/app-shell-regression-fixes.css");
const day = read("app/day/page.tsx");

test("the installed Atlas header stays attached to the viewport without overflow ancestors", () => {
  assert.match(layout, /import "\.\/contextual-app-shell\.css";[\s\S]*import "\.\/app-shell-regression-fixes\.css";/);
  assert.match(fixes, /html,[\s\S]*body[\s\S]*overflow-x: clip !important/);
  assert.match(fixes, /\.atlas-phone-shell[\s\S]*overflow-x: clip !important/);
  assert.match(fixes, /\.atlas-phone-top,[\s\S]*position: sticky !important/);
  assert.match(fixes, /top: 0 !important/);
});

test("overdue carry-forward rows never stack legacy and Living Day labels over the title", () => {
  assert.match(day, /atlas-day-overdue-badge/);
  assert.match(fixes, /\.atlas-day-overdue-badge,[\s\S]*\.atlas-day-consequence-kicker[\s\S]*display: none !important/);
  assert.match(fixes, /atlas-day-overdue-task-card[\s\S]*padding: 8px 4px 18px 10px !important/);
  assert.match(fixes, /grid-template-columns: minmax\(0, 1fr\) !important/);
});
