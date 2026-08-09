import { NextResponse } from "next/server";

import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type DayWindow = "morning" | "afternoon" | "evening";
type AutomaticKind = "queue" | "rhythm";

type AutomaticCandidate = {
  id: string;
  sourceKind: AutomaticKind;
  sourceId: string;
  title: string;
  note: string | null;
  environment: string | null;
  location: string | null;
  expectedActiveMinutes: number;
  automatic: true;
  conditional: boolean;
  reason: string | null;
  dayWindow: DayWindow;
  workOrderNumber: number;
};

type QueueRow = {
  id: string;
  position: number;
  state: string;
  task_id: string | null;
  planned_occurrence_id: string | null;
  metadata: Record<string, unknown> | null;
};

type OccurrenceRow = {
  id: string;
  title: string | null;
  state: string;
  planned_due_date: string | null;
  task_payload: Record<string, unknown> | null;
  effort_units: number | string | null;
};

type UnavailabilityRow = {
  unavailable_start: string;
  unavailable_end: string;
};

type MowingTaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  metadata: Record<string, unknown> | null;
};

type RhythmStateRow = {
  id: string;
  rhythm_rule_id: string;
  subject_id: string | null;
  state: string;
  due_at: string | null;
  metadata: Record<string, unknown> | null;
};

type RhythmRuleRow = {
  id: string;
  rule_key: string;
  label: string;
  validity_interval_seconds: number;
  player_routing: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

type MowingPlan = {
  ruleId: string;
  routeKey: string;
  title: string;
  location: string;
  nextDue: string;
  cadenceDays: number;
  expectedMinutes: number;
  releasedTaskId?: string;
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

function centralDateFromTimestamp(value: string | null) {
  if (!value) return "9999-12-31";
  return centralDateIso(new Date(value));
}

function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()));
}

function isSunday(dateIso: string) {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay() === 0;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isUnavailable(dateIso: string, ranges: UnavailabilityRow[]) {
  return ranges.some((row) => dateIso >= row.unavailable_start && dateIso <= row.unavailable_end);
}

function isWorkerDay(dateIso: string, ranges: UnavailabilityRow[]) {
  return !isSunday(dateIso) && !isUnavailable(dateIso, ranges);
}

function workerDayOnOrAfter(dateIso: string, ranges: UnavailabilityRow[]) {
  let cursor = dateIso;
  while (!isWorkerDay(cursor, ranges)) cursor = addDaysIso(cursor, 1);
  return cursor;
}

function nextWorkerDay(dateIso: string, ranges: UnavailabilityRow[]) {
  return workerDayOnOrAfter(addDaysIso(dateIso, 1), ranges);
}

function previousWorkerDay(dateIso: string, ranges: UnavailabilityRow[]) {
  let cursor = addDaysIso(dateIso, -1);
  while (!isWorkerDay(cursor, ranges)) cursor = addDaysIso(cursor, -1);
  return cursor;
}

function workerDaysThrough(startIso: string, endIso: string, ranges: UnavailabilityRow[]) {
  const days: string[] = [];
  let cursor = workerDayOnOrAfter(startIso, ranges);
  while (cursor <= endIso) {
    days.push(cursor);
    cursor = nextWorkerDay(cursor, ranges);
  }
  return days;
}

function estimatedQueueMinutes(occurrence: OccurrenceRow) {
  const payload = recordValue(occurrence.task_payload);
  const metadata = recordValue(payload.metadata);
  const explicit = numberValue(metadata.estimated_minutes);
  if (explicit > 0) return Math.round(explicit);
  const effort = numberValue(occurrence.effort_units || payload.effort_units || metadata.effort_units);
  if (effort > 0) return Math.max(20, Math.round(effort * 15));
  return 30;
}

function mowingRouteKey(metadata: Record<string, unknown>) {
  const explicit = textValue(metadata.mowing_route_key);
  if (explicit) return explicit;
  const member = textValue(metadata.canonical_collection_member_key) || textValue(metadata.collection_member_key);
  if (!member) return "";
  return member.startsWith("mowing_") ? member : `mowing_${member}`;
}

function mowingMinutes(ruleKey: string) {
  if (ruleKey.includes("follow_me")) return 20;
  return 60;
}

function mowingTaskTitle(task: MowingTaskRow) {
  return task.title.replace(/^Mowing\s*[—·:-]\s*/i, "Mow · ");
}

function mowingTaskLocation(task: MowingTaskRow) {
  const metadata = recordValue(task.metadata);
  return textValue(metadata.display_location)
    || textValue(metadata.collection_label)
    || textValue(metadata.collection_zone)
    || task.title.replace(/^Mowing\s*[—·:-]\s*/i, "");
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "automatic-worker-day-rhythm-plan-v2",
    },
  });
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  if (!validDateIso(requestedDate)) return privateJson({ ok: false, error: "date must be YYYY-MM-DD." }, 400);

  const dateIso = requestedDate as string;
  const today = centralDateIso();
  if (dateIso < today) return privateJson({ ok: true, active: false, date: dateIso, candidates: [] });

  try {
    const operatorContext = await readAtlasOwnerOperatorContext();
    const membershipId = effectiveOperatorMembershipId(operatorContext);
    const effective = operatorContext?.effective ?? null;
    if (!operatorContext?.isOperating || !membershipId || !effective?.farmId || effective.farmRole !== "farm_hand") {
      return privateJson({ ok: true, active: false, date: dateIso, candidates: [] });
    }

    const supabase = await createAtlasServerClient();
    const unavailableRead = await supabase
      .from("member_unavailability")
      .select("unavailable_start,unavailable_end")
      .eq("farm_id", effective.farmId)
      .eq("membership_id", membershipId)
      .eq("active", true)
      .lte("unavailable_start", dateIso)
      .gte("unavailable_end", today);
    if (unavailableRead.error) throw new Error(unavailableRead.error.message);
    const unavailable = (unavailableRead.data ?? []) as UnavailabilityRow[];

    if (!isWorkerDay(dateIso, unavailable)) {
      return privateJson({ ok: true, active: true, date: dateIso, candidates: [] });
    }

    const candidates: AutomaticCandidate[] = [];

    // WEEDING: one serial slot per workday. The currently active card occupies the
    // current/next available workday. Future inspection assumes that card is finished,
    // so each queued card advances by exactly one worker day. If the active card is
    // actually left unfinished, tomorrow's live carry-forward replaces this projection.
    const queueRead = await supabase
      .from("task_release_queue_items")
      .select("id,position,state,task_id,planned_occurrence_id,metadata")
      .eq("farm_id", effective.farmId)
      .eq("queue_key", "anna_weeding_rotation")
      .in("state", ["active", "queued"])
      .order("position", { ascending: true });
    if (queueRead.error) throw new Error(queueRead.error.message);
    const queueRows = (queueRead.data ?? []) as QueueRow[];
    const occurrenceIds = queueRows.map((row) => row.planned_occurrence_id).filter((value): value is string => Boolean(value));
    const occurrenceRead = occurrenceIds.length
      ? await supabase
          .from("planned_work_occurrences")
          .select("id,title,state,planned_due_date,task_payload,effort_units")
          .in("id", occurrenceIds)
      : { data: [], error: null };
    if (occurrenceRead.error) throw new Error(occurrenceRead.error.message);
    const occurrences = new Map(((occurrenceRead.data ?? []) as OccurrenceRow[]).map((row) => [row.id, row] as const));
    const queue = queueRows
      .map((row) => ({ row, occurrence: row.planned_occurrence_id ? occurrences.get(row.planned_occurrence_id) : undefined }))
      .filter((entry): entry is { row: QueueRow; occurrence: OccurrenceRow } => Boolean(
        entry.occurrence && !["cancelled", "completed"].includes(entry.occurrence.state),
      ));

    const activeWeed = queue.find((entry) => entry.row.state === "active");
    let weedCursor = activeWeed ? workerDayOnOrAfter(today, unavailable) : previousWorkerDay(today, unavailable);
    if (activeWeed?.occurrence.planned_due_date && activeWeed.occurrence.planned_due_date > weedCursor) {
      weedCursor = workerDayOnOrAfter(activeWeed.occurrence.planned_due_date, unavailable);
    }

    for (const entry of queue) {
      if (entry.row.state === "active") continue;
      let projectedDate = nextWorkerDay(weedCursor, unavailable);
      if (entry.occurrence.planned_due_date && entry.occurrence.planned_due_date > projectedDate) {
        projectedDate = workerDayOnOrAfter(entry.occurrence.planned_due_date, unavailable);
      }
      if (projectedDate === dateIso) {
        const payload = recordValue(entry.occurrence.task_payload);
        const metadata = recordValue(payload.metadata);
        candidates.push({
          id: `automatic-weed:${entry.row.id}`,
          sourceKind: "queue",
          sourceId: entry.row.id,
          title: entry.occurrence.title || "Weed Card",
          note: textValue(payload.note) || null,
          environment: "outdoor",
          location: textValue(metadata.display_location) || textValue(metadata.collection_zone) || textValue(metadata.collection_label) || null,
          expectedActiveMinutes: estimatedQueueMinutes(entry.occurrence),
          automatic: true,
          conditional: true,
          reason: "Automatic daily Weed Card. If the prior workday's Weed Card is unfinished, that same card takes this slot instead and the queue shifts forward.",
          dayWindow: "morning",
          workOrderNumber: 10002,
        });
      }
      weedCursor = projectedDate;
    }

    // MOWING: reserve one mowing slot on every available worker day. A real released
    // mowing task still owns the slot, but Atlas also returns its planning projection so
    // the client can keep one mowing row visible even if that dated task is absent from
    // the rendered task feed. The planning row yields whenever the real card is present.
    const firstWorkday = workerDayOnOrAfter(today, unavailable);
    const mowingTaskRead = await supabase
      .from("tasks")
      .select("id,title,due_date,metadata")
      .eq("farm_id", effective.farmId)
      .eq("assigned_membership_id", membershipId)
      .in("status", ["open", "blocked"])
      .eq("action_key", "mow")
      .not("due_date", "is", null)
      .lte("due_date", dateIso)
      .order("due_date", { ascending: true });
    if (mowingTaskRead.error) throw new Error(mowingTaskRead.error.message);
    const mowingTasks = (mowingTaskRead.data ?? []) as MowingTaskRow[];

    const stateRead = await supabase
      .from("rhythm_state")
      .select("id,rhythm_rule_id,subject_id,state,due_at,metadata")
      .eq("farm_id", effective.farmId)
      .eq("rhythm_key", "mowing");
    if (stateRead.error) throw new Error(stateRead.error.message);
    const states = (stateRead.data ?? []) as RhythmStateRow[];
    const ruleIds = Array.from(new Set(states.map((state) => state.rhythm_rule_id)));
    const ruleRead = ruleIds.length
      ? await supabase
          .from("rhythm_rules")
          .select("id,rule_key,label,validity_interval_seconds,player_routing,metadata")
          .in("id", ruleIds)
      : { data: [], error: null };
    if (ruleRead.error) throw new Error(ruleRead.error.message);
    const rules = new Map(((ruleRead.data ?? []) as RhythmRuleRow[]).map((rule) => [rule.id, rule] as const));

    const mowingPlan: MowingPlan[] = states.flatMap((state) => {
      const rule = rules.get(state.rhythm_rule_id);
      if (!rule) return [];
      const routing = recordValue(rule.player_routing);
      if (textValue(routing.assignedMembershipId) !== membershipId) return [];
      const routeKey = rule.rule_key.startsWith("elm_") ? rule.rule_key.slice(4) : rule.rule_key;
      const location = rule.label.replace(/^Mowing\s*·\s*/i, "");
      return [{
        ruleId: rule.id,
        routeKey,
        title: `Mow · ${location}`,
        location,
        nextDue: centralDateFromTimestamp(state.due_at),
        cadenceDays: Math.max(1, Math.round(numberValue(rule.validity_interval_seconds) / 86400) || 7),
        expectedMinutes: mowingMinutes(rule.rule_key),
      }];
    });

    const workdays = workerDaysThrough(firstWorkday, dateIso, unavailable);
    let automaticMow: MowingPlan | null = null;
    for (const day of workdays) {
      const explicit = mowingTasks
        .filter((task) => {
          const effectiveDate = task.due_date && task.due_date < firstWorkday ? firstWorkday : task.due_date;
          return effectiveDate === day;
        })
        .sort((left, right) => left.title.localeCompare(right.title))[0];

      if (explicit) {
        const metadata = recordValue(explicit.metadata);
        const routeKey = mowingRouteKey(metadata);
        const matching = mowingPlan.find((plan) => plan.routeKey === routeKey);
        if (day === dateIso) {
          automaticMow = matching
            ? {
                ...matching,
                title: mowingTaskTitle(explicit),
                location: mowingTaskLocation(explicit),
                releasedTaskId: explicit.id,
              }
            : {
                ruleId: `task:${explicit.id}`,
                routeKey,
                title: mowingTaskTitle(explicit),
                location: mowingTaskLocation(explicit),
                nextDue: day,
                cadenceDays: Math.max(1, numberValue(metadata.recreate_after_days) || 7),
                expectedMinutes: mowingMinutes(routeKey || explicit.title.toLowerCase()),
                releasedTaskId: explicit.id,
              };
        }
        if (matching) matching.nextDue = addDaysIso(day, matching.cadenceDays);
        continue;
      }

      const next = [...mowingPlan].sort((left, right) => {
        if (left.nextDue !== right.nextDue) return left.nextDue.localeCompare(right.nextDue);
        return left.title.localeCompare(right.title);
      })[0];
      if (!next) continue;
      if (day === dateIso) automaticMow = { ...next };
      next.nextDue = addDaysIso(day, next.cadenceDays);
    }

    if (automaticMow) {
      candidates.push({
        id: `automatic-mow:${automaticMow.releasedTaskId ?? automaticMow.ruleId}:${dateIso}`,
        sourceKind: "rhythm",
        sourceId: automaticMow.releasedTaskId ?? automaticMow.ruleId,
        title: automaticMow.title,
        note: null,
        environment: "outdoor",
        location: automaticMow.location,
        expectedActiveMinutes: automaticMow.expectedMinutes,
        automatic: true,
        conditional: true,
        reason: automaticMow.releasedTaskId
          ? "This workday already has a released mowing task. This planning row yields to the real mowing card when that card is present."
          : "Automatic mowing slot. Atlas is showing one mowing area per worker day without releasing the task early.",
        dayWindow: "evening",
        workOrderNumber: 99000,
      });
    }

    candidates.sort((left, right) => left.workOrderNumber - right.workOrderNumber || left.title.localeCompare(right.title));
    return privateJson({
      ok: true,
      active: true,
      date: dateIso,
      operatorLabel: effective.displayName,
      automaticMinutes: candidates.reduce((total, candidate) => total + candidate.expectedActiveMinutes, 0),
      candidates,
    });
  } catch (error) {
    console.error("Atlas automatic day-work projection failed:", error);
    return privateJson({ ok: false, error: "Atlas could not project automatic daily work." }, 500);
  }
}
