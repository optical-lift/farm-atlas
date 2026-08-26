import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assembleTaskMoveCore } from "../lib/atlas/task-move-assembly-core.js";

const explicitInstructions = [
  "Give yourself about 45min to harvest, Mary's a sweetheart but keep this to just business and you can get to know her better later.",
  "Mary phone: (417) 380-7830",
  "Text Mary from Elm's Google Voice number before leaving.",
];

test("Task Move preserves explicit worker instructions without rewriting or truncation", () => {
  const task = {
    task_id: "00000000-0000-4000-8000-000000000003",
    title: "Harvest supplemental flowers",
    task_type: "harvest",
    status: "open",
    priority: "high",
    due_date: "2026-08-26",
    metadata: {
      display_action: "Harvest",
      display_subject: "Mary's garden",
      execution_place: "Mary's garden · Springfield",
    },
  };
  const execution = {
    doText: "Harvest supplemental flowers at Mary's garden.",
    placeText: "Mary's garden · Springfield",
    howLines: explicitInstructions,
    doneWhen: "The assigned harvest is finished.",
    details: null,
    dueLabel: "Due Aug 26",
  };
  const display = {
    route: "harvest",
    action: "Harvest",
    subject: "Mary's garden",
    location: "Mary's garden · Springfield",
  };

  const assembly = assembleTaskMoveCore({
    task,
    execution,
    display,
    moveSemantics: {
      route: "harvest",
      instruction: "Harvest",
      placeLabel: "Mary's garden · Springfield",
      dueLabel: "Due Aug 26",
    },
    moveContext: null,
  });

  assert.deepEqual(assembly.execution.how, explicitInstructions);
});

test("canonical task instructions are selected upstream and rendered downstream", () => {
  const executionSource = readFileSync(new URL("../lib/atlas/task-execution.ts", import.meta.url), "utf8");
  const assemblySource = readFileSync(new URL("../lib/atlas/task-move-assembly.ts", import.meta.url), "utf8");
  const briefSource = readFileSync(new URL("../components/atlas/task-execution-brief.tsx", import.meta.url), "utf8");

  assert.match(executionSource, /metadataLines\(task, ["']execution_how["']\)/);
  assert.match(executionSource, /explicitHow\.length\s*\?\s*explicitHow\s*:\s*fallbackHow\(task\)/);
  assert.match(assemblySource, /const execution = taskExecutionModel\(task\)/);
  assert.match(assemblySource, /assembleTaskMoveCore\(\{[\s\S]*?execution,/);
  assert.match(briefSource, /resolvedAssembly\?\.execution\.how\.length/);
  assert.match(briefSource, /how=\{resolvedHow\}/);
});
