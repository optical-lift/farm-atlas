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

test("Anna compatibility route renders through the institution-generic employee work contract", () => {
  const annaPage = read("app/anna/page.tsx");
  const delivery = read("lib/worker-delivery.ts");
  const journal = read("lib/employee-work-journal.ts");
  const journalServer = read("lib/employee-work-journal-server.ts");
  const journalClient = read("components/employee/EmployeeWorkJournalClient.tsx");
  const controller = read("app/anna/AnnaWorkJournalController.tsx");
  const api = read("app/api/anna/pilot/route.ts");

  assert.match(annaPage, /getCurrentWorkerSessionContext/);
  assert.match(annaPage, /getAtlasSession/);
  assert.match(annaPage, /membershipForFarm\(session, ELM_FARM_ID\)/);
  assert.match(annaPage, /canSeeWholeFarm\(farmMembership\.role\)/);
  assert.match(annaPage, /if \(!workerContext && !supervisorCanView\)/);
  assert.match(annaPage, /getAnnaWorkerDelivery/);
  assert.match(annaPage, /buildEmployeeWorkJournalFromDelivery/);
  assert.match(annaPage, /journalIssuer/);
  assert.match(annaPage, /operatingUnitName/);
  assert.match(annaPage, /organizationName/);
  assert.match(annaPage, /organizationName=\{journalIssuer\}/);
  assert.doesNotMatch(annaPage, />Work Journal</);
  assert.match(annaPage, /AnnaWorkJournalController/);
  assert.match(annaPage, /Sign in to Atlas to see your work/);

  assert.match(journal, /kind: "employee_work_journal_day"/);
  assert.match(journal, /EmployeeWorkJournalInstitution/);
  assert.match(journal, /displayTitle/);
  assert.match(journal, /stripDuplicateTime/);
  assert.match(journal, /guidance: \[\.\.\.new Set/);
  assert.match(journal, /summaryLine/);
  assert.match(journal, /nextTimed/);
  assert.doesNotMatch(journal, /GUIDANCE_FILLER_TOKENS|guidanceAddsInformation|informativeGuidance/);
  assert.doesNotMatch(journal, /Elm Farm|Anna|farmId|farm_id/);

  assert.match(journalServer, /from\("farms"\)/);
  assert.match(journalServer, /buildEmployeeWorkJournalFromDelivery/);
  assert.doesNotMatch(journalServer, /from\("organizations"\)/);
  assert.doesNotMatch(journalServer, /from\("organization_units"\)/);
  assert.doesNotMatch(journalServer, /from\("organization_positions"\)/);
  assert.doesNotMatch(journalServer, /ELM_FARM_ID|ANNA_FARM_MEMBERSHIP_ID/);

  assert.match(journalClient, /Today’s work summary/);
  assert.match(journalClient, /Today’s work/);
  assert.match(journalClient, /Open work details/);
  assert.match(journalClient, /selectedEntry\.guidance\.map/);
  assert.match(journalClient, /opensDrawer = canEdit \|\| entry\.guidance\.length > 0/);
  assert.match(journalClient, /disabled=\{!opensDrawer\}/);
  assert.doesNotMatch(journalClient, /entryGuidance|entry\.guidance\.slice\(0, 2\)|selectedExtraGuidance/);
  assert.doesNotMatch(journalClient, /Journal entry/);
  assert.doesNotMatch(journalClient, /Assigned today/);
  assert.doesNotMatch(journalClient, /Elm Farm|Anna|farm_id|farmId/);

  // The compatibility route/controller may know the legacy lane and command
  // endpoint, but the reusable employee work contract and UI may not.
  assert.match(delivery, /getAnnaWorkerDelivery/);
  assert.match(controller, /\/api\/anna\/pilot/);

  assert.match(api, /EMPLOYEE_SEAT_SCOPE/);
  assert.match(api, /worker_delivery_employee_transition_self_api_v1/);
  assert.match(api, /worker_delivery_pilot_transition_v1/);
  assert.match(api, /projection_not_delivered_today/);
});
