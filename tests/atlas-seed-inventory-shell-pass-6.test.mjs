import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loader = readFileSync(
  new URL("../components/atlas/seed-inventory-task-loader.tsx", import.meta.url),
  "utf8",
);
const focus = readFileSync(
  new URL("../app/task-focus/[taskId]/SeedInventoryFocusPage.tsx", import.meta.url),
  "utf8",
);

test("seed inventory runs inside the universal assigned-task shell", () => {
  assert.match(loader, /AssignedTaskExecutionShell/);
  assert.match(loader, /SeedInventoryContextInstrument/);
  assert.match(loader, /SeedInventoryResultInstrument/);
  assert.doesNotMatch(loader, /<main className="atlas-phone-shell/);
  assert.doesNotMatch(focus, /<main className=\{styles\.shell\}/);
  assert.doesNotMatch(focus, /<Link/);
});

test("seed inventory preserves its physical reconciliation instrument", () => {
  assert.match(focus, /data-atlas-method-instrument="seed-inventory"/);
  assert.match(focus, /data-atlas-result-instrument="seed-inventory"/);
  assert.match(focus, /Count confirmed/);
  assert.match(focus, /Count corrected/);
  assert.match(focus, /Received or restocked/);
  assert.match(focus, /Depleted/);
  assert.match(focus, /Unable to verify/);
  assert.match(focus, /Problem found/);
  assert.match(focus, /Retire this seed lot/);
  assert.match(focus, /\/api\/atlas\/seed-inventory/);
  assert.match(focus, /action: "result"/);
});

test("seed inventory physical results fail closed on canonical Task Move readiness", () => {
  assert.match(focus, /!assembly/);
  assert.match(focus, /assembly\.readiness\.status === "blocked"/);
  assert.match(focus, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(focus, /saving \|\| busy \|\| !complete \|\| moveBlocked/);
  assert.match(focus, /if \(!outcome \|\| !complete \|\| saving \|\| busy \|\| moveBlocked\) return/);
});

test("seed inventory loading failures cannot fall through to generic Done", () => {
  assert.match(loader, /resultInstrument=\{\(\{ assembly, busy, returnHref \}\) => focus \?/);
  assert.match(loader, /: null\}/);
  assert.match(loader, /This recount is missing its canonical seed-lot link/);
});
