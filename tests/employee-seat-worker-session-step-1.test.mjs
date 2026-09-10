import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("employee worker session resolves institutional access before delivery", () => {
  const session = read("lib/worker-session.ts");
  const annaPilot = read("lib/anna-worker-day-pilot.ts");

  assert.match(session, /export type WorkerSessionContext/);
  assert.match(session, /organizationMembershipId: string/);
  assert.match(session, /deliveryMembershipId: string/);
  assert.match(session, /organizationId: string/);
  assert.match(session, /employeeSeatId\?: string/);
  assert.match(session, /EMPLOYEE_SEAT_SCOPE/);
  assert.match(session, /organization_employee_appointments_by_auth_user_v1/);
  assert.doesNotMatch(session, /ANNA_FARM_MEMBERSHIP_ID/);
  assert.doesNotMatch(session, /getAnnaWorkerDelivery/);

  assert.match(annaPilot, /getCurrentWorkerSessionContext/);
  assert.match(annaPilot, /EMPLOYEE_SEAT_SCOPE/);
  assert.match(annaPilot, /WORKER_DAY_PILOT_SCOPE/);
});

test("Anna Worker Day has no public delivery fallback and employee edits use the seat-bound command", () => {
  const annaPage = read("app/anna/page.tsx");
  const delivery = read("lib/worker-delivery.ts");
  const api = read("app/api/anna/pilot/route.ts");

  assert.match(annaPage, /getCurrentWorkerSessionContext/);
  assert.match(annaPage, /Sign in to Atlas to see your work/);
  assert.doesNotMatch(annaPage, /getAnnaWorkerDelivery/);
  assert.match(annaPage, /<EmployerPocket items=\{\[\]\} \/>/);
  assert.match(annaPage, /AnnaWorkerDayClient/);

  // The legacy compatibility loader may still exist for a validated Work Pass,
  // but it is no longer reachable from the unauthenticated page render.
  assert.match(delivery, /getAnnaWorkerDelivery/);

  assert.match(api, /EMPLOYEE_SEAT_SCOPE/);
  assert.match(api, /worker_delivery_employee_transition_self_api_v1/);
  assert.match(api, /worker_delivery_pilot_transition_v1/);
  assert.match(api, /projection_not_delivered_today/);
});
