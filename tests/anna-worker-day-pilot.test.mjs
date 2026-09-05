import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Anna Worker Day pilot stays a delivery interaction membrane", () => {
  const api = read("app/api/anna/pilot/route.ts");
  const delivery = read("lib/worker-delivery.ts");

  assert.match(api, /worker_delivery_pilot_transition_v1/);
  assert.match(api, /getAnnaWorkerDelivery/);
  assert.match(api, /projection_not_delivered_today/);
  assert.doesNotMatch(api, /\.from\(["']work_items["']\)/);
  assert.doesNotMatch(api, /weed_card|crop_cycle|harvest_occurrence/);

  assert.match(delivery, /done_reported/);
  assert.match(delivery, /institutionallyCompleted/);
  assert.match(delivery, /delivery_membership_id/);
  assert.match(delivery, /rollover_policy === "carry"/);
});

test("Anna edit access uses one-time redemption and an HttpOnly strict cookie", () => {
  const editRoute = read("app/anna/edit/route.ts");
  const helper = read("lib/anna-worker-day-pilot.ts");

  assert.match(editRoute, /redeem_worker_delivery_pilot_capability_v1/);
  assert.match(editRoute, /NextResponse\.redirect\(cleanUrl, 303\)/);
  assert.match(editRoute, /httpOnly: true/);
  assert.match(editRoute, /sameSite: "strict"/);
  assert.match(helper, /sha256/);
});

test("Anna phone surface has quiet completion, attention, correction, and unknown-work capture", () => {
  const client = read("app/anna/AnnaWorkerDayClient.tsx");
  const page = read("app/anna/page.tsx");

  assert.match(client, /I finished it/);
  assert.match(client, /I stopped working on it/);
  assert.match(client, /Never mind — I’m still working on it/);
  assert.match(client, /type="time"/);
  assert.match(client, /\+ Add something I did/);
  assert.doesNotMatch(client, /elapsed|duration|hours worked|timesheet/i);

  assert.match(page, /getAnnaWorkerDelivery/);
  assert.doesNotMatch(page, /Monday, Sept\. 7|Tuesday, Sept\. 8|Friday, Sept\. 11/);
});
