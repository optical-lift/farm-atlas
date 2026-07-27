import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Atlas exposes one global primitive package for shell, cards, state, metrics, and footer actions", () => {
  const primitives = read("components/atlas/ui/AtlasPrimitives.tsx");
  const css = read("app/atlas-primitives.css");
  const globals = read("app/globals.css");
  const layout = read("app/layout.tsx");

  for (const name of [
    "AtlasAppShell",
    "AtlasTopBar",
    "AtlasCard",
    "AtlasSectionHeading",
    "AtlasMetricStrip",
    "AtlasStateBadge",
    "AtlasFooterActions",
  ]) {
    assert.match(primitives, new RegExp(`export function ${name}`));
  }

  assert.match(layout, /import "\.\/atlas-primitives\.css"/);
  assert.match(globals, /--atlas-shell-max:\s*430px/);
  assert.match(globals, /width:\s*min\(100%, var\(--atlas-shell-max, 430px\)\)/);
  assert.match(css, /--atlas-space-1:/);
  assert.match(css, /--atlas-radius-panel:/);
  assert.match(css, /--atlas-shadow-card:/);
  assert.match(css, /--atlas-state-blocked:/);
  assert.match(css, /\.atlas-topbar/);
  assert.match(css, /\.atlas-card/);
  assert.match(css, /\.atlas-metric-strip/);
  assert.match(css, /\.atlas-state-badge/);
  assert.match(css, /\.atlas-footer-actions/);
});

test("farm and Feast Guild homes consume the same shell and primitive identities", () => {
  const farm = read("components/atlas/home/AtlasHomePortal.tsx");
  const guild = read("components/atlas/portfolio/FeastGuildPortfolioHome.tsx");

  for (const source of [farm, guild]) {
    assert.match(source, /from "@\/components\/atlas\/ui\/AtlasPrimitives"/);
    assert.match(source, /<AtlasAppShell/);
    assert.match(source, /<AtlasTopBar/);
    assert.match(source, /<AtlasCard/);
    assert.match(source, /<AtlasMetricStrip/);
    assert.match(source, /<AtlasFooterActions/);
  }

  assert.doesNotMatch(guild, /styles\.headerStatus|styles\.addButton|styles\.snapshotBar|styles\.footerRow/);
});

test("the CSS retirement inventory is explicit before legacy deletion", () => {
  const inventory = read("docs/atlas-css-inventory-july-28-2026.md");
  assert.match(inventory, /Retirement follows migration/);
  assert.match(inventory, /portfolio\.module\.css/);
  assert.match(inventory, /task-dominion-card\.css/);
  assert.match(inventory, /task-tending-trail\.css/);
  assert.match(inventory, /Build 1 boundary/);
});
