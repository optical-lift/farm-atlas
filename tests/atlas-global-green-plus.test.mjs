import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const shellUrl = new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url);
const homeUrl = new URL("../components/atlas/home/AtlasUniversalHomeV2.tsx", import.meta.url);
const retiredAddUrl = new URL("../components/atlas/global-atlas-add.tsx", import.meta.url);
const retiredStylesUrl = new URL("../components/atlas/global-atlas-add.module.css", import.meta.url);

const shell = readFileSync(shellUrl, "utf8");
const home = readFileSync(homeUrl, "utf8");

test("the global green plus is retired from Atlas", () => {
  assert.doesNotMatch(shell, /GlobalAtlasAdd/);
  assert.doesNotMatch(shell, /aria-label="Add to Atlas"/);
  assert.equal(existsSync(retiredAddUrl), false);
  assert.equal(existsSync(retiredStylesUrl), false);
});

test("no darker-green Home proxy replaces the retired global plus", () => {
  assert.doesNotMatch(shell, /HomeGreenPlusBridge/);
  assert.doesNotMatch(home, /atlas-note-plus/);
  assert.doesNotMatch(home, /aria-label="Document work"/);
  assert.doesNotMatch(home, /aria-label="Add to Atlas"/);
});
