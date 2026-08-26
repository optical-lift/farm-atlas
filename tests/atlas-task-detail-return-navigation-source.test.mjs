import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("task detail close wiring remains in the shared assigned-task header", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  assert.match(shell, /import \{ closeAtlasTaskDetail \} from "@\/lib\/atlas\/task-detail-navigation-client"/);
  assert.match(shell, /aria-label="Close task and return"/);
  assert.match(shell, /closeAtlasTaskDetail\(assignee\.listPath\)/);
  assert.doesNotMatch(shell, /aria-label=\{`Back to \$\{assignee\.label\} work`\}>↩<\/Link>/);
});
