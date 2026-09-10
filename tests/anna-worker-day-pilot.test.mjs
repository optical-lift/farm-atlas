import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Anna Worker Day stays a delivery interaction membrane", () => {
  const api = read("app/api/anna/pilot/route.ts");
  const delivery = read("lib/worker-delivery.ts");

  assert.match(api, /worker_delivery_employee_transition_self_api_v1/);
  assert.match(api, /worker_delivery_pilot_transition_v1/);
  assert.match(api, /getCurrentWorkerSessionContext/);
  assert.match(api, /getWorkerDelivery\(workerContext\)/);
  assert.match(api, /projection_not_delivered_today/);
  assert.doesNotMatch(api, /\.from\(["']work_items["']\)/);
  assert.doesNotMatch(api, /weed_card|crop_cycle|harvest_occurrence/);

  assert.match(delivery, /done_reported/);
  assert.match(delivery, /institutionallyCompleted/);
  assert.match(delivery, /reportedCompleted/);
  assert.match(delivery, /work_result_contract_policies/);
  assert.match(delivery, /acceptance_mode/);
  assert.match(delivery, /delivery_membership_id/);
  assert.match(delivery, /rollover_policy === "carry"/);
  assert.match(delivery, /workerContext\.deliveryMembershipId/);
});

test("legacy Anna edit access still uses one-time redemption and an HttpOnly strict cookie", () => {
  const editRoute = read("app/anna/edit/route.ts");
  const helper = read("lib/anna-worker-day-pilot.ts");

  assert.match(editRoute, /redeem_worker_delivery_pilot_capability_v1/);
  assert.match(editRoute, /NextResponse\.redirect\(cleanUrl, 303\)/);
  assert.match(editRoute, /httpOnly: true/);
  assert.match(editRoute, /sameSite: "strict"/);
  assert.match(helper, /sha256/);
});

test("Anna phone surface has quiet completion, attention, correction, unknown-work capture, and no public work fallback", () => {
  const client = read("app/anna/AnnaWorkerDayClient.tsx");
  const page = read("app/anna/page.tsx");

  assert.match(client, /I finished it/);
  assert.match(client, /I stopped working on it/);
  assert.match(client, /Never mind — I’m still working on it/);
  assert.match(client, /type="time"/);
  assert.match(client, /\+ Add something I did/);
  assert.doesNotMatch(client, /elapsed|duration|hours worked|timesheet/i);

  assert.match(page, /getCurrentWorkerSessionContext/);
  assert.match(page, /getWorkerDelivery\(workerContext\)/);
  assert.match(page, /Sign in to Atlas to see your work/);
  assert.doesNotMatch(page, /getAnnaWorkerDelivery/);
  assert.doesNotMatch(page, /Monday, Sept\. 7|Tuesday, Sept\. 8|Friday, Sept\. 11/);
});

test("Worker Day distinguishes a worker report from institutional completion when review is required", () => {
  const client = read("app/anna/AnnaWorkerDayClient.tsx");
  const delivery = read("lib/worker-delivery.ts");

  assert.match(client, /reported · awaiting review/);
  assert.match(client, /item\.reportedCompleted && !item\.institutionallyCompleted/);
  assert.match(client, /item\.acceptanceMode === "manager_acceptance"/);
  assert.match(delivery, /acceptanceModeByContract/);
  assert.match(delivery, /acceptanceMode/);
  assert.match(delivery, /institutionallyCompleted \|\| reportedCompleted/);
});

test("domain-governed pot-up work keeps its structured completion path instead of ordinary Done", () => {
  const client = read("app/anna/AnnaWorkerDayClient.tsx");

  assert.match(client, /item\.resultContractKey === "production_pot_up_v1"/);
  assert.match(client, /openPotUpCompletion\(item\)/);
  assert.match(client, /action: "complete_pot_up"/);
  assert.match(client, /Save and finish/);
});
