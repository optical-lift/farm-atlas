import assert from "node:assert/strict";
import test from "node:test";

import { buildPersonAtlasProjection } from "../lib/atlas/person-atlas-projection-core.js";

function company(overrides = {}) {
  return {
    organization_name: "Elm",
    organization_unit_name: "Farm",
    work_item_id: crypto.randomUUID(),
    allocation_id: crypto.randomUUID(),
    title: "Transplant fall onions",
    work_state: "open",
    allocation_role: "responsible",
    allocated_at: "2026-08-31T12:00:00Z",
    execution_state: "ready",
    execution_reason: null,
    legacy_task_id: crypto.randomUUID(),
    next_target_at: "2026-09-10T05:00:00Z",
    ...overrides,
  };
}

function lines(projection) {
  return projection.sections.flatMap((section) => section.lines);
}

test("future Company Work remains visible even when it is not admitted to today", () => {
  const future = company({ title: "Transplant fall onions" });
  const projection = buildPersonAtlasProjection({
    forDate: "2026-08-31",
    daySequence: { items: [] },
    companyResponsibilities: [future],
  });

  assert.equal(projection.counts.company, 1);
  assert.equal(projection.truthBoundary.companyResponsibilityNeverCapacityFiltered, true);
  assert.equal(lines(projection).some((line) => line.sentence === "Transplant fall onions"), true);
  assert.equal(projection.sections.find((section) => section.label === "COMPANY")?.lines.length, 1);
  assert.equal(projection.sourceLinks[`company:${future.work_item_id}`], `/atlas/company/${future.work_item_id}`);
});

test("waiting and needs-resolution Company Work stays visible in WAITING", () => {
  const blocked = company({ title: "Transplant cabbage", execution_state: "waiting", execution_reason: "beds_not_ready" });
  const unresolved = company({ title: "Transplant chard", execution_state: "needs_resolution", execution_reason: "operation_identity_unresolved" });
  const projection = buildPersonAtlasProjection({
    forDate: "2026-08-31",
    companyResponsibilities: [blocked, unresolved],
  });

  const waiting = projection.sections.find((section) => section.label === "WAITING");
  assert.deepEqual(waiting?.lines.map((line) => line.sentence), ["Transplant cabbage", "Transplant chard"]);
  assert.equal(projection.counts.waitingCompany, 2);
  assert.equal(projection.sourceLinks[`company:${blocked.work_item_id}`], `/atlas/company/${blocked.work_item_id}`);
});

test("Worker Day can mark one Company responsibility now without hiding the rest", () => {
  const currentTaskId = crypto.randomUUID();
  const current = company({ title: "Count White Lite", legacy_task_id: currentTaskId });
  const future = company({ title: "Transplant kale" });
  const projection = buildPersonAtlasProjection({
    forDate: "2026-08-31",
    daySequence: {
      items: [
        { kind: "committed_task", id: `task:${currentTaskId}`, taskId: currentTaskId, title: "Count White Lite", status: "open" },
      ],
    },
    companyResponsibilities: [current, future],
  });

  const projected = lines(projection);
  assert.equal(projected.find((line) => line.sentence === "Count White Lite")?.state, "now");
  assert.equal(projected.some((line) => line.sentence === "Transplant kale"), true);
  assert.equal(projection.sourceLinks[`company:${current.work_item_id}`], `/atlas/company/${current.work_item_id}`);
  assert.equal(projection.sourceLinks[`company:${future.work_item_id}`], `/atlas/company/${future.work_item_id}`);
});

test("private reminders and rhythms coexist without impersonating Company Work", () => {
  const projection = buildPersonAtlasProjection({
    forDate: "2026-08-31",
    companyResponsibilities: [company({ title: "Harvest sunflowers" })],
    currentClaims: [
      {
        claimId: crypto.randomUUID(),
        claimType: "personal_reminder",
        lifecycleState: "accepted",
        subject: { domain: "personal", kind: "reminder", id: "bathroom" },
        value: { reminderId: "bathroom", label: "Clean the toilet", state: "open" },
      },
    ],
    rhythmOpportunities: [
      {
        opportunityId: crypto.randomUUID(),
        localDate: "2026-09-01",
        timezone: "America/Chicago",
        startsAt: "2026-09-01T22:00:00Z",
        endsAt: "2026-09-01T23:00:00Z",
        projectionState: "projected",
        presentationState: "base",
        effectivePresentation: { label: "Pilates" },
      },
    ],
  });

  assert.equal(projection.sections.find((section) => section.label === "PERSONAL")?.lines[0].sentence, "Clean the toilet");
  assert.equal(projection.sections.find((section) => section.label === "RHYTHMS")?.lines[0].sentence, "Pilates");
  assert.equal(projection.truthBoundary.personalClaimsRemainPrivate, true);
  assert.equal(projection.truthBoundary.rhythmsAreNotTasks, true);
});

test("completed private reminders do not remain in the open Person Atlas projection", () => {
  const projection = buildPersonAtlasProjection({
    forDate: "2026-08-31",
    currentClaims: [
      {
        claimId: crypto.randomUUID(),
        claimType: "personal_reminder",
        lifecycleState: "accepted",
        subject: { domain: "personal", kind: "reminder", id: "bathroom" },
        value: { reminderId: "bathroom", label: "Clean the toilet", state: "done" },
      },
    ],
  });

  assert.equal(projection.counts.personal, 0);
  assert.equal(lines(projection).some((line) => line.sentence === "Clean the toilet"), false);
});
