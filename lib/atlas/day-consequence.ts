import type { AtlasTaskCard } from "./task-cards-client";

export type AtlasDayConsequenceKind = "continued" | "returned" | "overdue" | "at_risk";

export type AtlasDayConsequence = {
  kind: AtlasDayConsequenceKind;
  kicker: string;
  detail: string;
};

function centralDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateIsoFromTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : centralDateIso(date);
}

function shortDate(value: string | null | undefined) {
  if (!value) return "no date";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(startIso: string, endIso: string) {
  const start = new Date(`${startIso}T12:00:00Z`);
  const end = new Date(`${endIso}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function metadataText(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function metadataValue(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
}

function truthy(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === "1" || value === 1;
}

export function atlasIsDayTaskDone(task: AtlasTaskCard) {
  return task.status === "done" || task.task_outcomes?.[0]?.outcome === "done";
}

export function atlasIsDayExtraCredit(task: AtlasTaskCard) {
  const mode = String(metadataValue(task, "day_work_order_mode") ?? metadataValue(task, "work_order_mode") ?? "").trim().toLowerCase();
  const label = `${String(metadataValue(task, "day_work_order_label") ?? "")} ${String(metadataValue(task, "work_order_label") ?? "")}`.toLowerCase();
  return mode === "extra_credit" || label.includes("extra credit");
}

export function atlasIsDayDenominatorExcluded(task: AtlasTaskCard) {
  return atlasIsDayExtraCredit(task)
    || truthy(metadataValue(task, "day_denominator_excluded"))
    || truthy(metadataValue(task, "unlocked_outside_day_plan"));
}

export function atlasIsDayWorkTask(task: AtlasTaskCard) {
  const child = Boolean(task.parent_task_id)
    || truthy(metadataValue(task, "is_child_task"));
  const joined = `${task.task_type ?? ""} ${task.title} ${task.unlock_text ?? ""}`.toLowerCase();
  if (task.status === "archived" || task.status === "skipped" || child) return false;
  if (task.work_class === "crop_cycle" || task.task_type === "crop_cycle") return true;
  return !(joined.includes("verify")
    || joined.includes("check")
    || joined.includes("confirm")
    || joined.includes("count")
    || joined.includes("germin")
    || joined.includes("walk field rows"));
}

export function atlasIsFlexibleDayDeal(task: AtlasTaskCard) {
  if (atlasIsDayDenominatorExcluded(task)) return true;

  const mode = String(metadataValue(task, "day_work_order_mode") ?? metadataValue(task, "work_order_mode") ?? "").trim().toLowerCase();
  const protectedWork = task.priority === "high"
    || task.priority === "urgent"
    || truthy(metadataValue(task, "packet_required"))
    || truthy(metadataValue(task, "owner_schedule_override"))
    || truthy(metadataValue(task, "bed_clear_required"))
    || truthy(metadataValue(task, "departure_task"));

  if (protectedWork) return false;
  return mode === "flexible"
    || truthy(metadataValue(task, "optional_work"))
    || task.priority === "low";
}

function explicitAtRisk(task: AtlasTaskCard) {
  const values = [
    task.metadata?.clock_consequence,
    task.metadata?.clock_state,
    task.metadata?.risk_state,
    task.metadata?.day_consequence,
  ];
  return values.some((value) => typeof value === "string" && value.toLowerCase() === "at_risk");
}

export function atlasDayTaskConsequence(task: AtlasTaskCard, selectedDay: string): AtlasDayConsequence | null {
  if (atlasIsDayTaskDone(task)) return null;

  const dueDate = task.due_date;
  const overdueDays = dueDate && dueDate < selectedDay ? daysBetween(dueDate, selectedDay) : 0;
  const latestOutcome = task.task_outcomes?.[0] ?? null;
  const latestTransition = task.task_transitions?.[0] ?? null;
  const partialCount = (task.task_outcomes ?? []).filter((event) => event.outcome === "partial").length;

  if (latestOutcome?.outcome === "partial" || latestTransition?.transition === "partial") {
    const occurredOn = dateIsoFromTimestamp(latestOutcome?.created_at ?? latestTransition?.created_at) ?? dueDate;
    const carry = overdueDays
      ? `overdue ${overdueDays}d · due ${shortDate(dueDate)}`
      : dueDate ? `original due ${shortDate(dueDate)}` : "still open";
    return {
      kind: "continued",
      kicker: `Continuing from ${shortDate(occurredOn)}`,
      detail: `Partly done${partialCount > 1 ? ` ${partialCount}×` : ""} · ${carry}`,
    };
  }

  const handoff = metadataRecord(task.metadata?.last_owner_problem_handoff);
  const returnedFromOwner = Boolean(handoff) && (
    latestOutcome?.outcome === "reopened"
    || latestTransition?.transition === "checklist_open"
    || latestTransition?.work_class === "owner_resolution"
  );
  if (returnedFromOwner) {
    const response = metadataText(handoff, "owner_response");
    const carry = overdueDays
      ? `overdue ${overdueDays}d · due ${shortDate(dueDate)}`
      : dueDate ? `original due ${shortDate(dueDate)}` : "returned open";
    return {
      kind: "returned",
      kicker: "Returned from Owner",
      detail: `${response ? "Owner response recorded" : "Problem resolved"} · ${carry}`,
    };
  }

  if (explicitAtRisk(task)) {
    return {
      kind: "at_risk",
      kicker: "At risk",
      detail: overdueDays ? `Overdue ${overdueDays}d · due ${shortDate(dueDate)}` : `Due ${shortDate(dueDate)}`,
    };
  }

  if (overdueDays) {
    return {
      kind: "overdue",
      kicker: "Fallen out of rhythm",
      detail: `Overdue ${overdueDays}d · due ${shortDate(dueDate)}`,
    };
  }

  return null;
}

export function atlasIsCarriedDayTask(task: AtlasTaskCard, selectedDay: string) {
  const consequence = atlasDayTaskConsequence(task, selectedDay);
  return consequence?.kind === "continued"
    || consequence?.kind === "returned"
    || consequence?.kind === "overdue";
}
