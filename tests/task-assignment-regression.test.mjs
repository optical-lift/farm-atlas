import test from "node:test";
import assert from "node:assert/strict";
import { assignedTaskHrefCore, resolveTaskAssigneeCore } from "../lib/atlas/task-assignment-core.js";
import { resolveNextTaskDateCore } from "../lib/atlas/task-calendar-core.js";

const task = (metadata) => ({ metadata });

test("explicit assignee_key has highest precedence", () => {
  assert.equal(resolveTaskAssigneeCore(task({ assignee_key: "marshall", owner_task: true })).key, "marshall");
});

test("owner lane outranks Marshall on conflicting legacy flags", () => {
  assert.equal(resolveTaskAssigneeCore(task({ owner_task: true, marshall_task: true })).key, "owner");
});

test("Kids lane outranks Anna supervision metadata", () => {
  assert.equal(resolveTaskAssigneeCore(task({ children_task: true, assigned_to: "Anna" })).key, "kids");
});

test("legacy assigned_to and work_route values normalize", () => {
  assert.equal(resolveTaskAssigneeCore(task({ assigned_to: "Owner" })).key, "owner");
  assert.equal(resolveTaskAssigneeCore(task({ work_route: "marshall" })).key, "marshall");
  assert.equal(resolveTaskAssigneeCore(task({ collection_zone: "children" })).key, "kids");
});

test("unknown assignment falls back to Farm Team", () => {
  assert.equal(resolveTaskAssigneeCore(task({ assigned_to: "unknown" })).key, "farm_team");
});

test("focused links use canonical list paths", () => {
  assert.equal(assignedTaskHrefCore("abc/123", "owner"), "/task-focus/abc%2F123?returnTo=%2Fowner");
  assert.equal(assignedTaskHrefCore("abc", "kids"), "/task-focus/abc?returnTo=%2Fchildren");
});

test("overdue and today tasks move from today", () => {
  assert.equal(resolveNextTaskDateCore("2026-07-14", "2026-07-15"), "2026-07-16");
  assert.equal(resolveNextTaskDateCore("2026-07-15", "2026-07-15"), "2026-07-16");
});

test("future tasks move one day after their due date", () => {
  assert.equal(resolveNextTaskDateCore("2026-07-20", "2026-07-15"), "2026-07-21");
});

test("calendar math crosses month and year boundaries", () => {
  assert.equal(resolveNextTaskDateCore("2026-07-31", "2026-07-15"), "2026-08-01");
  assert.equal(resolveNextTaskDateCore("2026-12-31", "2026-07-15"), "2027-01-01");
});
