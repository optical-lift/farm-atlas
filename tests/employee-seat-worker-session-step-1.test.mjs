import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("employee seat step 1 introduces only the generic worker session context boundary", () => {
  const session = read("lib/worker-session.ts");
  const annaPilot = read("lib/anna-worker-day-pilot.ts");

  assert.match(session, /export type WorkerSessionContext/);
  assert.match(session, /organizationMembershipId: string/);
  assert.match(session, /deliveryMembershipId: string/);
  assert.match(session, /organizationId: string/);
  assert.match(session, /scope: string/);
  assert.match(session, /expiresAt: string/);
  assert.match(session, /worker_delivery_pilot_session_status_v1/);
  assert.match(session, /organization_memberships/);
  assert.doesNotMatch(session, /ANNA_FARM_MEMBERSHIP_ID/);
  assert.doesNotMatch(session, /getAnnaWorkerDelivery/);
  assert.doesNotMatch(session, /worker_delivery_pilot_transition_v1/);

  assert.match(annaPilot, /getCurrentWorkerSessionContext/);
  assert.match(annaPilot, /getAnnaPilotSessionToken/);
});

test("employee seat step 1 does not prematurely redesign Worker Day or routing", () => {
  const annaPage = read("app/anna/page.tsx");
  const delivery = read("lib/worker-delivery.ts");
  const api = read("app/api/anna/pilot/route.ts");

  assert.match(annaPage, /getAnnaWorkerDelivery/);
  assert.match(annaPage, /AnnaWorkerDayClient/);
  assert.match(delivery, /getAnnaWorkerDelivery/);
  assert.match(api, /worker_delivery_pilot_transition_v1/);
  assert.match(api, /projection_not_delivered_today/);
});
