import assert from "node:assert/strict";
import test from "node:test";

import {
  addScheduleDays,
  buildTaskScheduleProjection,
} from "../lib/atlas/task-schedule-core.js";

const rows = [
  {
    task_id: "today-open",
    title: "Sow sunflowers",
    task_type: "sowing",
    status: "open",
    priority: "high",
    due_date: "2026-07-21",
    zone_label: "Berry Walk",
    object_label: "BW 8",
    assigned_membership_id: "membership-anna",
    assigned_display_name: "Anna",
    assigned_worker_key: "anna",
    visibility_scope: "assigned_worker",
    schedule_lane: "today",
    total_steps: 2,
    completed_steps: 1,
    can_act: true,
    counts_for_window: true,
  },
  {
    task_id: "today-done",
    title: "Check grow room",
    task_type: "check",
    status: "done",
    priority: "normal",
    due_date: "2026-07-21",
    assigned_display_name: "Anna",
    visibility_scope: "assigned_worker",
    schedule_lane: "completed",
    total_steps: 0,
    completed_steps: 0,
    can_act: false,
    counts_for_window: true,
  },
  {
    task_id: "today-blocked",
    title: "Mulch Main Garden",
    task_type: "maintenance",
    status: "blocked",
    priority: "normal",
    due_date: "2026-07-21",
    blocker_text: "No mulch available.",
    visibility_scope: "management",
    schedule_lane: "blocked",
    total_steps: 0,
    completed_steps: 0,
    can_act: false,
    counts_for_window: true,
  },
  {
    task_id: "carryover-overdue",
    title: "Trim forsythia",
    task_type: "pruning",
    status: "open",
    priority: "normal",
    due_date: "2026-07-18",
    visibility_scope: "assigned_worker",
    schedule_lane: "overdue",
    total_steps: 0,
    completed_steps: 0,
    can_act: true,
    counts_for_window: false,
  },
  {
    task_id: "carryover-blocked",
    title: "Buy soil",
    task_type: "resource",
    status: "blocked",
    priority: "high",
    due_date: "2026-07-17",
    visibility_scope: "owner",
    schedule_lane: "blocked",
    total_steps: 0,
    completed_steps: 0,
    can_act: false,
    counts_for_window: false,
  },
  {
    task_id: "tomorrow-open",
    title: "Harvest flowers",
    task_type: "harvest",
    status: "open",
    priority: "urgent",
    due_date: "2026-07-22",
    visibility_scope: "assigned_worker",
    schedule_lane: "scheduled",
    total_steps: 0,
    completed_steps: 0,
    can_act: true,
    counts_for_window: true,
  },
  {
    task_id: "undated",
    title: "Organize seed room",
    task_type: "record",
    status: "open",
    priority: "low",
    due_date: null,
    visibility_scope: "management",
    schedule_lane: "undated",
    total_steps: 0,
    completed_steps: 0,
    can_act: false,
    counts_for_window: false,
  },
];

test("day progress counts only tasks due on the selected date", () => {
  const schedule = buildTaskScheduleProjection({
    rows,
    startDate: "2026-07-21",
    endDate: "2026-07-21",
  });

  assert.deepEqual(schedule.progress, {
    total: 3,
    completed: 1,
    open: 2,
    blocked: 1,
    percent: 33,
  });
  assert.equal(schedule.days[0].tasks.length, 3);
  assert.equal(schedule.counts.carryoverOverdue, 1);
  assert.equal(schedule.counts.carryoverBlocked, 1);
  assert.equal(schedule.counts.undated, 1);
});

test("carryover and undated work remain visible without inflating date progress", () => {
  const schedule = buildTaskScheduleProjection({
    rows,
    startDate: "2026-07-21",
    endDate: "2026-07-21",
  });

  assert.equal(schedule.carryover.blocked[0].taskId, "carryover-blocked");
  assert.equal(schedule.carryover.overdue[0].taskId, "carryover-overdue");
  assert.equal(schedule.carryover.undated[0].taskId, "undated");
  assert.equal(schedule.carryover.blocked[0].countsForWindow, false);
  assert.equal(schedule.carryover.overdue[0].countsForWindow, false);
});

test("week projection creates every date and places work on its actual due date", () => {
  const schedule = buildTaskScheduleProjection({
    rows,
    startDate: "2026-07-21",
    endDate: "2026-07-27",
  });

  assert.equal(schedule.days.length, 7);
  assert.equal(schedule.days[0].date, "2026-07-21");
  assert.equal(schedule.days[1].date, "2026-07-22");
  assert.equal(schedule.days[1].tasks[0].taskId, "tomorrow-open");
  assert.equal(schedule.days[6].date, "2026-07-27");
});

test("preserves location, assignee, progress, and action authority", () => {
  const schedule = buildTaskScheduleProjection({
    rows,
    startDate: "2026-07-21",
    endDate: "2026-07-22",
  });
  const task = schedule.days[0].tasks.find((item) => item.taskId === "today-open");

  assert.equal(task.zone.label, "Berry Walk");
  assert.equal(task.object.label, "BW 8");
  assert.equal(task.assignee.displayName, "Anna");
  assert.equal(task.totalSteps, 2);
  assert.equal(task.completedSteps, 1);
  assert.equal(task.canAct, true);
});

test("calendar date math crosses month and year boundaries", () => {
  assert.equal(addScheduleDays("2026-07-28", 6), "2026-08-03");
  assert.equal(addScheduleDays("2026-12-29", 6), "2027-01-04");
});
