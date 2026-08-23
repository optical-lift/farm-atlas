import assert from "node:assert/strict";
import test from "node:test";

import { buildOwnerMyWorkProjection } from "../lib/atlas/owner-my-work-core.js";

const ownerMembershipId = "owner-membership";
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
    parentTaskId: overrides.parentTaskId ?? null,
    metadata: overrides.metadata ?? {},
  };
}

test("Owner My Work reconciles responsibility without turning visibility into a date-only filter", () => {
  const projection = buildOwnerMyWorkProjection({
    ownerMembershipId,
    today: "2026-08-22",
    weekEnd: "2026-08-28",
    principalTimeZone: "America/Chicago",
    tasks: [
      task({ id: "today", assignedMembershipId: ownerMembershipId, dueDate: "2026-08-22" }),
      task({ id: "owner-scope", assignedMembershipId: otherMembershipId, visibilityScope: "owner", dueDate: "2026-08-25" }),
      task({ id: "blocked", assignedMembershipId: ownerMembershipId, status: "blocked", dueDate: "2026-08-20", blocker: "Waiting on a real prerequisite." }),
      task({ id: "overdue", assignedMembershipId: ownerMembershipId, dueDate: "2026-08-14" }),
      task({ id: "later", assignedMembershipId: ownerMembershipId, dueDate: "2026-09-15" }),
      task({ id: "someone-elses-shared", assignedMembershipId: otherMembershipId, visibilityScope: "farm_shared", dueDate: "2026-08-22" }),
      task({ id: "child", visibilityScope: "owner", parentTaskId: "parent", dueDate: "2026-08-22" }),
    ],
    principalCandidates: [
      {
        domain: "marketing",
        sourceType: "owner_obligation",
        sourceId: "obligation-now",
        title: "Prepare Fall Fest",
        floorClass: 2,
        windowStart: "2026-08-21T09:00:00-05:00",
        windowEnd: null,
        fixedStart: null,
        mustBeginBy: "2026-08-24T09:00:00-05:00",
        mustFinishBy: null,
        expectedMinutes: 45,
        protectionLevel: "protected",
        ownerRequired: true,
        consequence: "Preparation gets compressed into urgency.",
        reasonForFloor: null,
        portfolioUnitId: null,
        horizon: "H1",
      },
      {
        domain: "finance",
        sourceType: "owner_obligation",
        sourceId: "obligation-week",
        title: "Review cash requirement",
        floorClass: 3,
        windowStart: null,
        windowEnd: null,
        fixedStart: null,
        mustBeginBy: "2026-08-27T10:00:00-05:00",
        mustFinishBy: null,
        expectedMinutes: 30,
        protectionLevel: "normal",
        ownerRequired: true,
        consequence: null,
        reasonForFloor: "Principal review is required.",
        portfolioUnitId: null,
        horizon: "H1",
      },
      {
        domain: "household",
        sourceType: "household_rhythm",
        sourceId: "not-owner-required",
        title: "Household rhythm",
        floorClass: 4,
        windowStart: "2026-08-22T12:00:00-05:00",
        windowEnd: null,
        fixedStart: null,
        mustBeginBy: null,
        mustFinishBy: null,
        expectedMinutes: 60,
        protectionLevel: "protected",
        ownerRequired: false,
        consequence: null,
        reasonForFloor: null,
        portfolioUnitId: null,
        horizon: null,
      },
      {
        domain: "strategy",
        sourceType: "attention_subject",
        sourceId: "undated-principal",
        title: "Review a quiet responsibility",
        floorClass: 4,
        windowStart: null,
        windowEnd: null,
        fixedStart: null,
        mustBeginBy: null,
        mustFinishBy: null,
        expectedMinutes: 20,
        protectionLevel: "normal",
        ownerRequired: true,
        consequence: null,
        reasonForFloor: null,
        portfolioUnitId: null,
        horizon: "H2",
      },
    ],
  });

  assert.deepEqual(projection.buckets.now.map((item) => item.sourceId), ["obligation-now"]);
  assert.deepEqual(projection.buckets.today.map((item) => item.sourceId), ["today"]);
  assert.deepEqual(projection.buckets.thisWeek.map((item) => item.sourceId), ["owner-scope", "obligation-week"]);
  assert.deepEqual(projection.buckets.waiting.map((item) => item.sourceId), ["blocked"]);
  assert.deepEqual(projection.buckets.backlog.map((item) => item.sourceId), ["overdue", "later", "undated-principal"]);

  assert.equal(projection.counts.all, 8);
  assert.equal(projection.counts.overdue, 2);
  assert.equal(projection.counts.taskItems, 5);
  assert.equal(projection.counts.principalItems, 3);
  assert.equal(projection.audit.assignedTaskCount, 4);
  assert.equal(projection.audit.ownerScopeTaskCount, 1);
  assert.equal(projection.audit.excludedTaskRows, 2);
  assert.equal(projection.audit.excludedPrincipalCandidates, 1);
  assert.equal(projection.audit.bucketedItems, projection.counts.all);
  assert.equal(projection.audit.unexplainedItems, 0);
});

test("a blocked task stays visible as waiting even when its due date is old", () => {
  const projection = buildOwnerMyWorkProjection({
    ownerMembershipId,
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
