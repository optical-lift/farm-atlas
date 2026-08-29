"use client";

import type { MouseEvent } from "react";

import ManagerDaySurface from "@/components/atlas/manage/ManagerDaySurface";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

const DATE_ISO = "2026-08-29";

function task(id: string, title: string, taskType: string, assignee: "owner" | "anna" | "marshall", status: "open" | "blocked" | "done", dueDate: string, zone: string, priority = "normal", note: string | null = null): AtlasTaskCard {
  return {
    farm_key: "elm-farm",
    task_id: id,
    title,
    task_type: taskType,
    status,
    priority,
    due_date: dueDate,
    unlock_text: null,
    blocker_text: status === "blocked" ? "Waiting on a prerequisite before execution can continue." : null,
    note,
    generated_from: "fixture",
    generated_from_id: null,
    action_key: taskType,
    work_class: "physical",
    operation_class: null,
    operation_class_source: null,
    parent_task_id: null,
    task_series_key: null,
    engine_instance_key: null,
    created_at: `${DATE_ISO}T06:00:00-05:00`,
    updated_at: `${DATE_ISO}T08:00:00-05:00`,
    metadata: { assignee_key: assignee, executor_worker_key: assignee, executor_label: assignee === "owner" ? "Owner" : assignee === "anna" ? "Anna" : "Marshall" },
    zone_id: null,
    zone_key: zone.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    zone_label: zone,
    task_logs: [],
    task_outcomes: status === "done" ? [{ event_id: `${id}-outcome`, outcome: "done", lane_key: null, work_key: null, blocker_reason: null, note: "Completed in the fixture day.", created_at: `${DATE_ISO}T09:00:00-05:00` }] : [],
    task_transitions: [],
    objects: [],
    resource_requirements: [],
    action_templates: [],
    move_context: null,
  };
}

const TASKS: AtlasTaskCard[] = [
  task("00000000-0000-4000-8000-000000000201", "Fix raised bed frame", "repair", "marshall", "blocked", "2026-08-27", "Main Garden", "high"),
  task("00000000-0000-4000-8000-000000000202", "Weed Field Row 13", "weed", "anna", "open", DATE_ISO, "Field Rows", "high"),
  task("00000000-0000-4000-8000-000000000203", "Transplant cabbage into MG7", "transplant", "anna", "open", DATE_ISO, "Main Garden"),
  task("00000000-0000-4000-8000-000000000204", "Set September public calendar", "planning", "owner", "open", DATE_ISO, "Elm Farm"),
  task("00000000-0000-4000-8000-000000000205", "Adjust north barn door", "repair", "marshall", "open", DATE_ISO, "Barn"),
  task("00000000-0000-4000-8000-000000000206", "Saturday Farm Round", "farm_round", "anna", "done", DATE_ISO, "Elm Farm"),
];

export default function DesignAtlasManagerDay() {
  function holdFixtureNavigation(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("a")) event.preventDefault();
  }

  return (
    <div data-atlas-design-manager="canonical-component" data-live-data-binding="none" data-mutation-capability="none" onClickCapture={holdFixtureNavigation}>
      <ManagerDaySurface farmName="Elm Farm" dateIso={DATE_ISO} tasks={TASKS} fixtureOnly />
    </div>
  );
}
