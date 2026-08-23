import assert from "node:assert/strict";
import test from "node:test";

import { buildOwnerMyWorkProjection } from "../lib/atlas/owner-my-work-core.js";

const ownerMembershipId = "owner-membership";
const ownerUserId = "owner-user";
const otherMembershipId = "other-membership";

function task(overrides) {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    taskType: overrides.taskType ?? "general",
    status: overrides.status ?? "open",
    priority: overrides.priority ?? "normal",
    dueDate: overrides.dueDate ?? null,
    detail: overrides.detail ?? null,
    blocker: overrides.blocker ?? null,
    visibilityScope: overrides.visibilityScope ?? "assigned_worker",
    assignedMembershipId: overrides.assignedMembershipId ?? null,
    assignedUserId: overrides.assignedUserId ?? null,
    parentTaskId: overrides.parentTaskId ?? null,
    metadata: overrides.metadata ?? {},
  };
}

function candidate(overrides) {
  return {
    domain: overrides.domain ?? "operations",
    sourceType: overrides.sourceType ?? "requirement_truth_acquisition",
    sourceId: overrides.sourceId,
    title: overrides.title ?? overrides.sourceId,
    floorClass: overrides.floorClass ?? 3,
    windowStart: overrides.windowStart ?? null,
    windowEnd: overrides.windowEnd ?? null,
    fixedStart: overrides.fixedStart ?? null,
    mustBeginBy: overrides.mustBeginBy ?? null,
    mustFinishBy: overrides.mustFinishBy ?? null,
    expectedMinutes: overrides.expectedMinutes ?? 20,
    protectionLevel: overrides.protectionLevel ?? "normal",
    ownerRequired: overrides.ownerRequired ?? true,
    consequence: overrides.consequence ?? null,
    reasonForFloor: overrides.reasonForFloor ?? null,
    portfolioUnitId: overrides.portfolioUnitId ?? null,
    horizon: overrides.horizon ?? "H1",
  };
}

test("Owner My Work reconciles responsibility without turning visibility into a date-only filter", () => {
  const projection = buildOwnerMyWorkProjection({
    ownerMembershipId,
    ownerUserId,
    today: "2026-08-22",
    weekEnd: "2026-08-28",
    principalTimeZone: "America/Chicago",
    tasks: [
      task({ id: "today", assignedMembershipId: ownerMembershipId, dueDate: "2026-08-22" }),
      task({ id: "owner-scope", assignedMembershipId: otherMembershipId, visibilityScope: "owner", dueDate: "2026-08-25" }),
      task({ id: "user-assigned", assignedUserId: ownerUserId, visibilityScope: "management", dueDate: "2026-08-26" }),
      task({ id: "blocked", assignedMembershipId: ownerMembershipId, status: "blocked", dueDate: "2026-08-20", blocker: "Waiting on a real prerequisite." }),
      task({ id: "overdue", assignedMembershipId: ownerMembershipId, dueDate: "2026-08-14" }),
      task({ id: "later", assignedMembershipId: ownerMembershipId, dueDate: "2026-09-15" }),
      task({ id: "someone-elses-shared", assignedMembershipId: otherMembershipId, visibilityScope: "farm_shared", dueDate: "2026-08-22" }),
      task({ id: "child", visibilityScope: "owner", parentTaskId: "parent", dueDate: "2026-08-22" }),
    ],
    principalCandidates: [
      candidate({
        sourceType: "owner_obligation",
        sourceId: "obligation-now",
        title: "Prepare Fall Fest",
        floorClass: 2,
        windowStart: "2026-08-21T09:00:00-05:00",
        mustBeginBy: "2026-08-24T09:00:00-05:00",
        expectedMinutes: 45,
        consequence: "Preparation gets compressed into urgency.",
      }),
      candidate({
        domain: "finance",
        sourceType: "owner_obligation",
        sourceId: "obligation-week",
        title: "Review cash requirement",
        mustBeginBy: "2026-08-27T10:00:00-05:00",
        expectedMinutes: 30,
        reasonForFloor: "Principal review is required.",
      }),
      candidate({
        sourceId: "overdue",
        title: "overdue",
        windowStart: "2026-08-14T09:00:00-05:00",
      }),
      candidate({
        sourceId: "blocked",
        title: "blocked",
        windowStart: "2026-08-20T09:00:00-05:00",
      }),
      candidate({
        domain: "household",
        sourceType: "household_rhythm",
        sourceId: "not-owner-required",
        title: "Household rhythm",
        floorClass: 4,
        windowStart: "2026-08-22T12:00:00-05:00",
        expectedMinutes: 60,
        protectionLevel: "protected",
        ownerRequired: false,
        horizon: null,
      }),
      candidate({
        domain: "strategy",
        sourceType: "attention_subject",
        sourceId: "undated-principal",
        title: "Review a quiet responsibility",
        floorClass: 4,
        expectedMinutes: 20,
        horizon: "H2",
      }),
    ],
  });

  assert.deepEqual(projection.buckets.now.map((item) => item.sourceId), ["overdue", "obligation-now"]);
  assert.deepEqual(projection.buckets.today.map((item) => item.sourceId), ["today"]);
  assert.deepEqual(projection.buckets.thisWeek.map((item) => item.sourceId), ["owner-scope", "user-assigned", "obligation-week"]);
  assert.deepEqual(projection.buckets.waiting.map((item) => item.sourceId), ["blocked"]);
  assert.deepEqual(projection.buckets.backlog.map((item) => item.sourceId), ["later", "undated-principal"]);

  assert.equal(projection.counts.all, 9);
  assert.equal(projection.counts.overdue, 2);
  assert.equal(projection.counts.taskItems, 6);
  assert.equal(projection.counts.principalItems, 3);
  assert.equal(projection.counts.principalLinkedTaskItems, 2);
  assert.equal(projection.audit.assignedTaskCount, 5);
  assert.equal(projection.audit.ownerScopeTaskCount, 1);
  assert.equal(projection.audit.excludedTaskRows, 2);
  assert.equal(projection.audit.excludedPrincipalCandidates, 1);
  assert.equal(projection.audit.linkedPrincipalCandidates, 2);
  assert.equal(projection.audit.bucketedItems, projection.counts.all);
  assert.equal(projection.audit.unexplainedItems, 0);

  const reconciled = projection.buckets.now.find((item) => item.sourceId === "overdue");
  assert.equal(reconciled?.source, "task");
  assert.equal(reconciled?.href, "/owner/tasks/overdue");
  assert.equal(reconciled?.principalSignal?.sourceType, "requirement_truth_acquisition");
  assert.equal(projection.all.filter((item) => item.sourceId === "overdue").length, 1);

  const blocked = projection.buckets.waiting.find((item) => item.sourceId === "blocked");
  assert.equal(blocked?.principalSignal?.sourceType, "requirement_truth_acquisition");
  assert.equal(blocked?.bucket, "waiting");
});

test("a blocked task stays visible as waiting even when its due date is old", () => {
  const projection = buildOwnerMyWorkProjection({
    ownerMembershipId,
    ownerUserId,
    today: "2026-08-22",
    weekEnd: "2026-08-28",
    principalTimeZone: "America/Chicago",
    tasks: [task({ id: "blocked-old", assignedMembershipId: ownerMembershipId, status: "blocked", dueDate: "2026-07-01" })],
    principalCandidates: [],
  });

  assert.equal(projection.buckets.waiting.length, 1);
  assert.equal(projection.buckets.waiting[0].isOverdue, true);
  assert.equal(projection.buckets.backlog.length, 0);
});
