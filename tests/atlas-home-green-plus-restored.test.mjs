import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../components/atlas/home-green-plus-bridge.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../components/atlas/home-green-plus-bridge.module.css", import.meta.url), "utf8");

test("Home keeps its familiar header plus while using the global builder", () => {
  assert.match(shell, /import HomeGreenPlusBridge/);
  assert.match(shell, /<HomeGreenPlusBridge\s*\/>/);
  assert.ok(bridge.includes('aria-label="Document work"'));
  assert.ok(bridge.includes('button[aria-label="Add to Atlas"]'));
  assert.match(bridge, /globalTrigger\.click\(\)/);
});

test("the duplicate floating plus is hidden only when the Home header trigger exists", () => {
  assert.match(bridge, /dataset\.atlasHomeAddTrigger = "true"/);
  assert.match(styles, /visibility: visible !important/);
  assert.ok(styles.includes('body[data-atlas-home-add-trigger="true"] button[aria-label="Add to Atlas"]'));
  assert.match(styles, /display: none !important/);
});

test("the old Home field-log click cannot also open beneath the global builder", () => {
  assert.match(bridge, /event\.preventDefault\(\)/);
  assert.match(bridge, /event\.stopPropagation\(\)/);
  assert.match(bridge, /event\.stopImmediatePropagation\(\)/);
  assert.match(bridge, /addEventListener\("click", openGlobalAdd, true\)/);
});
