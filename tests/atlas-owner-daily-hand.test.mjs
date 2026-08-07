import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dailyHand = await readFile(new URL("../lib/atlas/daily-hand.ts", import.meta.url), "utf8");
const homePage = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("owner home builds a small hand instead of mirroring the flat due-task pile", () => {
  assert.match(dailyHand, /export function buildAtlasOwnerDailyHand/);
  assert.match(dailyHand, /taskMatchesAssignee\(card, "owner"\)/);
  assert.match(dailyHand, /card\.due_date <= today/);
  assert.match(dailyHand, /isChildTask\(card\) \|\| isQuietTask\(card\)/);
  assert.match(dailyHand, /const SLOT_ORDER: AtlasDailyHandSlot\[\] = \[/);
  assert.match(dailyHand, /"heartbeat"/);
  assert.match(dailyHand, /"future_money"/);
  assert.match(dailyHand, /"production"/);
  assert.match(dailyHand, /"physical"/);
  assert.match(dailyHand, /"watch_decision"/);
});

test("Daily Hand keeps blockers visible and retains canonical task links", () => {
  assert.match(dailyHand, /card\.status !== "open" && card\.status !== "blocked"/);
  assert.match(dailyHand, /const blockedRank = card\.status === "blocked" \? "0" : "1"/);
  assert.match(dailyHand, /href: `\/task-focus\/\$\{encodeURIComponent\(card\.task_id\)\}/);
  assert.match(dailyHand, /state: blocked \? "blocked" : overdue \? "attention" : "ready"/);
  assert.match(dailyHand, /card\.blocker_text \|\| display\.detail \|\| card\.unlock_text \|\| card\.note/);
});

test("owner Daily Hand is composed after set-aside filtering and preserves staff oversight", () => {
  const setAsideIndex = homePage.indexOf("const visibleFarms");
  const handIndex = homePage.indexOf("buildAtlasOwnerDailyHand(visibleHome");
  assert.ok(setAsideIndex >= 0, "home should build the visible farm set");
  assert.ok(handIndex > setAsideIndex, "Daily Hand must be built from the set-aside-filtered home");
  assert.match(homePage, /const staffMoves = carriedTaskOverview\.moves\.filter\(\(move\) => move\.kind === "collection"\)/);
  assert.match(homePage, /moves: \[\.\.\.ownerDailyHand, \.\.\.staffMoves\]/);
  assert.match(homePage, /prepared: true/);
});

test("farm-hand preview and real farm-hand mode never receive the owner Daily Hand", () => {
  assert.match(homePage, /const ownerDailyHand = switchedFarmHand \|\| farmHandMode\s*\? null\s*:\s*buildAtlasOwnerDailyHand/);
});
