import { clockLocalMinuteOfDay } from "@/lib/atlas/clock-layout";
import type { AtlasClockProposalPlan } from "@/lib/atlas/clock-proposal";
import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";
import type { AtlasWorkerDayChronology, AtlasWorkerDayChronologyItem } from "@/lib/atlas/worker-day-chronology";

type CommittedItem = Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;

function durationSource(item: CommittedItem) {
  if (item.plannedDurationMinutes && item.plannedDurationMinutes > 0) return "planned" as const;
  if (item.estimatedMinutes && item.estimatedMinutes > 0) return "estimate" as const;
  return "planning_default" as const;
}

function unresolvedReason(item: AtlasWorkerDayChronologyItem) {
  if (item.chronologyState === "awaiting_day_shape") return "Owner Day Shape is required before Atlas can propose a clock time.";
  if (item.chronologyState === "blocked_policy_conflict") return "More than one Worker Day policy applies here. Resolve the Day Shape conflict before planning this Clock.";
  if (item.chronologyState === "unplaced_no_lawful_interval") return "No open interval inside the authored Worker Day and this task's day window can hold the work.";
  return "Atlas has not found a lawful proposal interval for this work.";
}

export function buildAtlasClockProposalFromChronology(items: CommittedItem[], chronology: AtlasWorkerDayChronology | null): AtlasClockProposalPlan {
  if (!chronology) return { blocks: [], unresolved: [] };
  const openByTaskId = new Map(items.filter((item) => item.taskId && item.status !== "done" && item.status !== "completed").map((item) => [item.taskId as string, item]));
  const blocks: AtlasClockProposalPlan["blocks"] = [];
  const unresolved: AtlasClockProposalPlan["unresolved"] = [];
  const timeZone = chronology.dayShape.timezone || "America/Chicago";

  for (const entry of chronology.items) {
    if (!entry.taskId || entry.durationMinutes <= 0) continue;
    const item = openByTaskId.get(entry.taskId);
    if (!item) continue;
    if (entry.chronologyState === "proposed" && entry.startsAt) {
      const startMinute = clockLocalMinuteOfDay(entry.startsAt, timeZone);
      if (startMinute === null) {
        unresolved.push({ id: item.id, taskId: item.taskId, title: item.title, reason: "Atlas proposed this work, but its local clock time could not be resolved." });
        continue;
      }
      blocks.push({ id: `server-clock-proposal:${item.id}`, taskId: item.taskId, item, startMinute, endMinute: startMinute + entry.durationMinutes, durationMinutes: entry.durationMinutes, durationSource: durationSource(item), placementSource: "day_window", reason: "Fits inside the owner-authored Worker Day Shape after real reservations and committed Clock placements are removed.", conflict: false });
      continue;
    }
    if (["awaiting_day_shape", "blocked_policy_conflict", "unplaced_no_lawful_interval"].includes(entry.chronologyState)) unresolved.push({ id: item.id, taskId: item.taskId, title: item.title, reason: unresolvedReason(entry) });
  }

  return { blocks: blocks.sort((left, right) => left.startMinute - right.startMinute || left.item.sequenceOrder - right.item.sequenceOrder), unresolved };
}
