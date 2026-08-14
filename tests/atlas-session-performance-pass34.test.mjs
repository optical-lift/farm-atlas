import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const operatorContext = read("lib/atlas/operator-context.ts");
const workerPlan = read("lib/atlas/worker-day-plan-server.ts");

test("Worker Day target resolution reads one session and reuses it for operator context", () => {
  assert.match(workerPlan, /const session = await getAtlasSession\(\)/);
  assert.match(workerPlan, /resolveAtlasOwnerOperatorContextForSession\(session\)/);
  assert.doesNotMatch(workerPlan, /Promise\.all\(\[readAtlasOwnerOperatorContext\(\), getAtlasSession\(\)\]\)/);
  assert.equal((workerPlan.match(/getAtlasSession\(\)/g) ?? []).length, 1);
});

test("session-scoped operator resolution does not re-read auth session", () => {
  const scopedStart = operatorContext.indexOf("export async function resolveAtlasOwnerOperatorContextForSession");
  const publicStart = operatorContext.indexOf("export async function resolveAtlasOwnerOperatorContext(\n");
  assert.ok(scopedStart >= 0 && publicStart > scopedStart);
  const scoped = operatorContext.slice(scopedStart, publicStart);
  assert.doesNotMatch(scoped, /getAtlasSession\(/);
  assert.match(scoped, /owner_operator_accounts_v1|callOperatorContext/);
});

test("general operator-context callers retain the authenticated session boundary", () => {
  assert.match(operatorContext, /export async function resolveAtlasOwnerOperatorContext\([\s\S]*const session = await getAtlasSession\(\)/);
  assert.match(operatorContext, /return resolveAtlasOwnerOperatorContextForSession\(session, requestedAccountId\)/);
  assert.match(operatorContext, /export async function readAtlasOwnerOperatorContext\(\)/);
});
