import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prompt = readFileSync(
  new URL("../components/atlas/home/FarmHandQuickWinPrompt.tsx", import.meta.url),
  "utf8",
);
const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("farm-hand Home interrupts at natural transitions for bounded quick wins", () => {
  assert.match(home, /FarmHandQuickWinPrompt/);
  assert.match(home, /active=\{renderedFarmHandMode\}/);
  assert.match(prompt, /QUICK_WIN_MAX_MINUTES = 10/);
  assert.match(prompt, /This is a \{minuteLabel\} task\. Let’s do it before we move forward with the day\./);
  assert.match(prompt, /Do it now/);
});

test("quick wins rely on stored duration and avoid high-friction work", () => {
  assert.match(prompt, /expected_minutes/);
  assert.match(prompt, /estimated_active_minutes/);
  assert.match(prompt, /activation_demand/);
  assert.match(prompt, /ambiguity_load/);
  assert.match(prompt, /setup_load/);
  assert.match(prompt, /move\.state === "blocked"/);
});

test("the quick-win prompt is a strong nudge without removing Anna's task controls", () => {
  assert.match(prompt, /Close quick task prompt/);
  assert.match(prompt, /quickWin\.move\.href/);
  assert.doesNotMatch(prompt, /rescheduled|Tomorrow|Next week|Pick a date/);
});
