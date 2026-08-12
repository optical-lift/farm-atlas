import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
const add = read("components/atlas/global-atlas-add.tsx");
const moduleCss = read("components/atlas/global-atlas-add.module.css");
const visibility = read("app/global-add-shell-visibility.css");
const layout = read("app/layout.tsx");
const shellCss = read("app/app-shell-regression-fixes.css");

test("one shell-owned Add to Atlas action serves Home and every authenticated route", () => {
  assert.match(frame, /<GlobalAtlasAdd \/>/);
  assert.match(add, /aria-label="Add to Atlas"/);
  assert.doesNotMatch(frame, /if \(pathname === "\/"\)[\s\S]{0,180}<GlobalAtlasAdd/);
  assert.doesNotMatch(frame, /active === "home"[\s\S]{0,180}<GlobalAtlasAdd/);
  assert.match(frame, /if \(hidden\) return null/);
});

test("route headers cannot visually cover the canonical green plus", () => {
  assert.match(moduleCss, /\.floatingButton[\s\S]*position: fixed/);
  assert.match(moduleCss, /background: #6f9562/);
  assert.match(shellCss, /z-index: 980 !important/);
  assert.match(visibility, /button\[aria-label="Add to Atlas"\]/);
  assert.match(visibility, /z-index: 995 !important/);
  assert.match(layout, /global-add-shell-visibility\.css/);
});

test("Home fix does not create a second route-specific add button", () => {
  const home = read("app/page.tsx");
  assert.doesNotMatch(home, /GlobalAtlasAdd/);
  assert.doesNotMatch(home, /aria-label="Add to Atlas"/);
});
