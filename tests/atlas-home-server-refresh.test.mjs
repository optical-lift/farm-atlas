import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const refreshComponentPath = new URL("../components/atlas/home/AtlasHomeServerRefresh.tsx", import.meta.url);
const homePagePath = new URL("../app/page.tsx", import.meta.url);

test("Home reconciles restored router payloads with authoritative server state", async () => {
  const [refreshComponent, homePage] = await Promise.all([
    readFile(refreshComponentPath, "utf8"),
    readFile(homePagePath, "utf8"),
  ]);

  assert.match(refreshComponent, /router\.refresh\(\)/);
  assert.match(refreshComponent, /window\.addEventListener\("pageshow"/);
  assert.match(refreshComponent, /document\.addEventListener\("visibilitychange"/);
  assert.match(refreshComponent, /window\.addEventListener\("focus"/);
  assert.match(homePage, /import AtlasHomeServerRefresh/);
  assert.match(homePage, /<AtlasHomeServerRefresh \/>/);
});
