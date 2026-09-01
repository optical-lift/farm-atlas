import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appFrame = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const personAtlasPage = readFileSync(new URL("../app/atlas/page.tsx", import.meta.url), "utf8");
const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

test("Work destination resolves the current Person Atlas when navigation occurs", () => {
  assert.match(appFrame, /function todayHref\(\) \{\s*return "\/atlas";\s*\}/);
  assert.match(personAtlasPage, /const forDate = atlasFarmDateIso\(\);/);
  assert.match(personAtlasPage, /readPersonAtlasProjection\(session, forDate\)/);
});

test("Living Day still resolves today when explicitly opened from released work", () => {
  assert.match(personAtlasPage, /label: "Released work"[\s\S]*href: "\/day"/);
  assert.match(dayPage, /const dateIso = searchParams\.get\("date"\) \|\| todayIso\(\);/);
});

test("explicit historical day navigation remains supported", () => {
  assert.match(dayPage, /function dayHref\(dateIso: string\)/);
  assert.match(dayPage, /`\/day\?date=\$\{encodeURIComponent\(dateIso\)\}&view=work_order`/);
});
