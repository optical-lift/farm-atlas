import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appFrame = readFileSync(new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url), "utf8");
const personAtlasPage = readFileSync(new URL("../app/atlas/page.tsx", import.meta.url), "utf8");
const overview = readFileSync(new URL("../app/atlas/AtlasResponsibilityOverview.tsx", import.meta.url), "utf8");
const todayPage = readFileSync(new URL("../app/atlas/today/page.tsx", import.meta.url), "utf8");
const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

test("Work destination resolves the durable Atlas responsibility overview", () => {
  assert.match(appFrame, /function todayHref\(\) \{\s*return "\/atlas";\s*\}/);
  assert.match(personAtlasPage, /AtlasResponsibilityOverview/);
  assert.match(personAtlasPage, /readPersonAtlasProjection\(session, forDate\)/);
  assert.doesNotMatch(personAtlasPage, /PersonAtlasNotebookV2/);
  assert.match(overview, /Everything assigned to you or remembered by you lives here/);
});

test("Today is a narrower Person Atlas notebook projection", () => {
  assert.match(overview, /href="\/atlas\/today"/);
  assert.match(todayPage, /PersonAtlasNotebookV2/);
  assert.match(todayPage, /pageTitle="Today"/);
  assert.match(todayPage, /label: "Overview"[\s\S]*href: "\/atlas"/);
});

test("Living Day remains the bounded released-work execution surface", () => {
  assert.match(overview, /href="\/day"/);
  assert.match(todayPage, /label: "Released work"[\s\S]*href: "\/day"/);
  assert.match(dayPage, /const dateIso = searchParams\.get\("date"\) \|\| todayIso\(\);/);
});

test("explicit historical day navigation remains supported", () => {
  assert.match(dayPage, /function dayHref\(dateIso: string\)/);
  assert.match(dayPage, /`\/day\?date=\$\{encodeURIComponent\(dateIso\)\}&view=work_order`/);
});
