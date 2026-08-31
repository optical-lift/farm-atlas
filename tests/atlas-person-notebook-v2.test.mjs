import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/owner/page.tsx");
const ownerFixture = read("app/owner/OwnerPersonAtlasFixture.tsx");
const bridgeFixture = read("app/owner/design-atlas/BridgeAtlasFixture.tsx");
const notebook = read("app/owner/PersonAtlasNotebookV2.tsx");
const styles = read("app/owner/person-atlas-notebook-v2.module.css");
const manifest = read("app/manifest.ts");

test("person Atlas greets the signed-in person instead of labeling the shell", () => {
  assert.match(page, /getAtlasSession/);
  assert.match(page, /session\?\.displayName/);
  assert.match(ownerFixture, /identity=\{personName\}/);
  assert.match(ownerFixture, /greeting="hello"/);
  assert.doesNotMatch(ownerFixture, /MY ATLAS|One person · several lawful worlds|pageIntro|Fixture truth only/);
  assert.doesNotMatch(bridgeFixture, /MARA'S ATLAS|Reference person · household|pageIntro|BRIDGE FIXTURE|Synthetic reference person/);
  assert.match(bridgeFixture, /identity="Mara"/);
});

test("the notebook uses compact rapid-log marks and a vertical quiet menu", () => {
  assert.match(notebook, /return "×"/);
  assert.match(notebook, /return ">"/);
  assert.match(notebook, /return "•"/);
  assert.match(notebook, />\* •<\/span>/);
  assert.match(notebook, />⋮<\/button>/);
  assert.match(styles, /\.moreButton[\s\S]*color: #929292/);
  assert.match(styles, /\.taskLine strong[\s\S]*font-size: 12\.5px/);
  assert.match(styles, /\.currentTask strong[\s\S]*font-size: 13\.5px/);
});

test("Today behaves like a bounded numbered notebook page instead of an endless dashboard", () => {
  assert.match(notebook, /paginateSections/);
  assert.match(notebook, /PAGE_WEIGHT = 10/);
  assert.match(notebook, /aria-label="Notebook page navigation"/);
  assert.match(notebook, />index<\/button>/);
  assert.match(styles, /height: 100svh/);
  assert.match(styles, /grid-template-rows: auto minmax\(0, 1fr\) 34px/);
  assert.match(styles, /overflow: hidden/);
  assert.match(styles, /\.pageNav/);
});

test("Today header is a restrained notebook topic rather than a hero", () => {
  assert.match(styles, /\.dayHeader h1[\s\S]*font-family: var\(--font-atlas-hand\)/);
  assert.match(styles, /\.dayHeader h1[\s\S]*font-size: 18px/);
  assert.match(styles, /background-size: 15px 15px/);
  assert.doesNotMatch(ownerFixture, /pageIntro=/);
});

test("the installed owner surface requests white chrome", () => {
  assert.match(page, /themeColor: "#ffffff"/);
  assert.match(manifest, /background_color: "#ffffff"/);
  assert.match(manifest, /theme_color: "#ffffff"/);
});
