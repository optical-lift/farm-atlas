import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appFrame = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

test("Work destination resolves the farm day when navigation occurs", () => {
  assert.match(appFrame, /function todayHref\(\) \{\s*return "\/day";\s*\}/);
  assert.doesNotMatch(appFrame, /function todayHref\(\) \{[\s\S]*atlasFarmDateIso\(\)[\s\S]*\}/);
  assert.match(dayPage, /const dateIso = searchParams\.get\("date"\) \|\| todayIso\(\);/);
});

test("explicit historical day navigation remains supported", () => {
  assert.match(dayPage, /function dayHref\(dateIso: string\)/);
  assert.match(dayPage, /`\/day\?date=\$\{encodeURIComponent\(dateIso\)\}&view=work_order`/);
});
