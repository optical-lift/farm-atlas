import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/atlas/assigned-task-execution-shell.tsx", import.meta.url),
  "utf8",
);

test("ordinary task completion fails closed until Task Move is ready", () => {
  assert.match(source, /function canonicalCompletionBlocked/);
  assert.match(source, /\|\| !assembly/);
  assert.match(source, /assembly\.readiness\.status === "blocked"/);
  assert.match(source, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(source, /if \(outcome === "done" && canonicalCompletionBlocked\(assembly, doneDisabled\)\) return;/);
  assert.match(source, /doneDisabled=\{canonicalCompletionBlocked\(assembly, doneDisabled\)\}/);
});
