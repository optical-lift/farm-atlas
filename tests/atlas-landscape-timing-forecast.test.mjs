import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("annual landscape cards use the shared compact execution-detail contract", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const brief = read("components/atlas/task-execution-brief.tsx");
  const execution = read("lib/atlas/task-execution.ts");

  assert.match(shell, /TaskExecutionBrief/);
  assert.match(brief, /taskExecutionModel\(task\)/);
  assert.match(brief, /function VisibleMethod/);
  assert.match(brief, /className="atlas-worker-method"/);
  assert.doesNotMatch(brief, /<details className="atlas-worker-instructions">/);
  assert.doesNotMatch(brief, /<summary>Instructions<\/summary>/);
  assert.match(execution, /atlasMetaString\(task, "execution_details"\)/);
  assert.match(execution, /const details = explicitDetails/);

  // Timing still belongs to the shared execution contract. It should not grow a
  // second landscape-specific panel beside the ordinary Farm Hand card.
  assert.doesNotMatch(shell, /<strong>Timing forecast<\/strong>/);
  assert.doesNotMatch(shell, /timing\.facts\.map/);
  assert.doesNotMatch(shell, /"sow window": "Sow window"/);
  assert.equal(existsSync(new URL("../components/atlas/dominion-assigned-task-detail.tsx", import.meta.url)), false);
});
