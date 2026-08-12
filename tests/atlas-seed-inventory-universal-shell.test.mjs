import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("seed inventory recount is an instrument inside the universal assigned-task shell", () => {
  const loader = read("components/atlas/seed-inventory-task-loader.tsx");

  assert.match(loader, /AssignedTaskExecutionShell/);
  assert.match(loader, /data-atlas-method-instrument="seed-inventory"/);
  assert.match(loader, /data-atlas-result-instrument="seed-inventory"/);
  assert.match(loader, /\/api\/atlas\/seed-inventory/);
  assert.match(loader, /action: "result"/);
  assert.doesNotMatch(loader, /SeedInventoryFocusPage/);
  assert.doesNotMatch(loader, /<main className="atlas-phone-shell"/);
  assert.equal(existsSync(new URL("../app/task-focus/[taskId]/SeedInventoryFocusPage.tsx", import.meta.url)), false);
});

test("Farm Hand execution packet preserves only the stable seed-lot identity needed by the recount instrument", () => {
  const contract = read("lib/atlas/worker-execution-contract.ts");

  assert.match(contract, /"seed_lot_id"/);
  assert.match(contract, /"seed_inventory_recount"/);
  assert.doesNotMatch(contract, /"recorded_receipt_quantity"/);
  assert.doesNotMatch(contract, /"state_note"/);
});
