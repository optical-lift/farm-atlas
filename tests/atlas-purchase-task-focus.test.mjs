import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const focus = readFileSync(new URL("../components/atlas/project-task-focus.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/task-focus/[taskId]/focused-task-only.css", import.meta.url), "utf8");

test("purchase project tasks expose the stored note as a visible shopping list", () => {
  assert.match(focus, /task\.taskType === "purchase" \? purchaseList\(task\.note\) : \[\]/);
  assert.match(focus, /Shopping list/);
  assert.match(focus, /Take with you/);
  assert.match(focus, /split\(\/;\\s\*\|\\n\+\//);
  assert.match(focus, /shoppingItems\.length \? null : task\.note/);
  assert.match(css, /\.atlas-task-shopping-list/);
});
