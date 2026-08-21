import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const refreshComponentPath = new URL("../components/atlas/home/AtlasHomeServerRefresh.tsx", import.meta.url);
const homePagePath = new URL("../app/page.tsx", import.meta.url);

test("Home reconciles only restored or meaningfully stale browser state with authoritative server truth", async () => {
  const [refreshComponent, homePage] = await Promise.all([
    readFile(refreshComponentPath, "utf8"),
    readFile(homePagePath, "utf8"),
  ]);

  assert.match(refreshComponent, /router\.refresh\(\)/);
  assert.match(refreshComponent, /const STALE_AFTER_BACKGROUND_MS = 30_000/);
  assert.match(refreshComponent, /const MIN_REFRESH_INTERVAL_MS = 5_000/);
  assert.match(refreshComponent, /window\.addEventListener\("pageshow", handlePageShow\)/);
  assert.match(refreshComponent, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(refreshComponent, /if \(event\.persisted\) refreshFromServer\(\)/);
  assert.match(refreshComponent, /Date\.now\(\) - backgroundedAt >= STALE_AFTER_BACKGROUND_MS/);
  assert.doesNotMatch(refreshComponent, /window\.addEventListener\("focus"/);
  assert.doesNotMatch(refreshComponent, /setTimeout\([^\n]*router\.refresh/);
  assert.doesNotMatch(refreshComponent, /setTimeout\(refreshFromServer,\s*0\)/);
  assert.match(homePage, /import AtlasHomeServerRefresh/);
  assert.match(homePage, /<AtlasHomeServerRefresh \/>/);
});
