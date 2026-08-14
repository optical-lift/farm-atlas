import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const transport = read("lib/atlas/clock-command-client.ts");
const reconciliation = read("lib/atlas/runtime-reconciliation.ts");
const runtime = read("components/atlas/runtime/AtlasRuntimeProvider.tsx");
const controls = read("components/atlas/clock/clock-owner-controls.tsx");
const editor = read("components/atlas/clock/use-clock-plan-editor.ts");
const orchestrator = read("components/atlas/clock/clock-orchestrator.tsx");

test("Pass 19 keeps canonical Clock transport separate from runtime reconciliation", () => {
  assert.match(transport, /commitAtlasClockCommand/);
  assert.match(transport, /\/api\/atlas\/owner-day-task-time/);
  assert.match(transport, /\/api\/atlas\/owner-day-task-duration/);
  assert.match(transport, /\/api\/atlas\/owner-clock-plan-commit/);
  assert.match(transport, /Canonical Clock mutation transport only/);
  assert.doesNotMatch(transport, /AtlasRuntimeProvider|pendingActions/);
});

test("runtime pending actions can overlay service-date scoped Clock choreography without advancing canonical revision", () => {
  assert.match(reconciliation, /kind: "clock_command"/);
  assert.match(reconciliation, /plannedStartAt/);
  assert.match(reconciliation, /plannedDurationMinutes/);
  assert.match(reconciliation, /localClockInstant/);
  assert.match(reconciliation, /America\/Chicago/);
  assert.match(reconciliation, /canonical revision belongs to the server projection/i);
  assert.match(reconciliation, /never fabricated here/i);
  assert.doesNotMatch(reconciliation, /revision:/);
});

test("AtlasRuntime owns optimistic Clock commit, isolated rollback, and authoritative reconciliation", () => {
  assert.match(runtime, /dispatchClockCommand/);
  assert.match(runtime, /runtime-clock-command:/);
  assert.match(runtime, /kind: "clock_command"/);
  assert.match(runtime, /commitAtlasClockCommand\(command\)/);
  assert.match(runtime, /pending\.actionId !== actionId/);
  assert.match(runtime, /phase: "reconciling" as const/);
  assert.match(runtime, /readWorkerDay\(command\.serviceDate, \{ force: true \}\)/);
  assert.match(runtime, /keep committed-looking overlay/i);
});

test("direct Owner Clock placement and duration edits use runtime commands instead of fetch plus reload", () => {
  assert.match(controls, /useAtlasRuntimeActions/);
  assert.match(controls, /dispatchClockCommand\(\{ kind: "clock_time"/);
  assert.match(controls, /dispatchClockCommand\(\{ kind: "clock_duration"/);
  assert.doesNotMatch(controls, /await props\.onChanged\(\)/);
  assert.doesNotMatch(controls, /fetch\(/);
});

test("Clock plan draft remains local while the atomic commit enters AtlasRuntime", () => {
  assert.match(editor, /setRawBlocks/);
  assert.match(editor, /function move/);
  assert.match(editor, /function resize/);
  assert.match(editor, /function unplace/);
  assert.match(editor, /dispatchClockCommand\(\{ kind: "clock_plan_commit"/);
  assert.doesNotMatch(editor, /fetch\("\/api\/atlas\/owner-clock-plan-commit"/);
  assert.doesNotMatch(editor, /await input\.onReload\(\)/);
});

test("Clock orchestrator no longer asks the plan editor to perform a second reload after commit", () => {
  assert.match(orchestrator, /useClockPlanEditor/);
  assert.doesNotMatch(orchestrator, /rebuildProposal:[^\n]+onReload:reload/);
  assert.match(orchestrator, /onCommitted:\(\)=>setProposalOpen\(false\)/);
});
