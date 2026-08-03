import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workerTodayPage = readFileSync(
  new URL("../app/work/today/page.tsx", import.meta.url),
  "utf8",
);
const appFrame = readFileSync(
  new URL("../components/atlas/shell/AtlasContextualAppFrame.tsx", import.meta.url),
  "utf8",
);

test("the permanent Work tab opens Living Day", () => {
  assert.match(appFrame, /return `\/day\?date=/);
  assert.match(appFrame, /key: "work"[\s\S]*href: workHref/);
});

test("management restored onto the legacy worker hand returns to Living Day", () => {
  assert.match(workerTodayPage, /access\.membership\.role !== "farm_hand"/);
  assert.match(workerTodayPage, /params\.inspect !== "1"/);
  assert.match(workerTodayPage, /redirect\(`\/day\?date=\$\{encodeURIComponent\(centralTodayIso\(\)\)\}&view=work_order`\)/);
});

test("the Farm Hand hand remains available and intentional inspection stays explicit", () => {
  const redirectPosition = workerTodayPage.indexOf("redirect(`/day?date=");
  const handPosition = workerTodayPage.indexOf("getWorkerHand(access)");
  assert.ok(redirectPosition >= 0 && handPosition > redirectPosition);
  assert.match(workerTodayPage, /params\.inspect !== "1"/);
  assert.match(workerTodayPage, /Read-only worker view/);
});
