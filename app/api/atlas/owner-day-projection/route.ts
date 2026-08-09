import { NextResponse } from "next/server";

import { readStoredOwnerWeekProjection } from "@/lib/atlas-data/owner-week-projection";
import {
  effectiveOperatorAccountId,
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasOperatorUniversalHome } from "@/lib/atlas/operator-universal-home";
import { getAtlasSession } from "@/lib/atlas/session";
import { atlasSupabase } from "@/lib/atlas/supabase-server";
import { atlasUniversalTaskCards } from "@/lib/atlas/universal-task-cards";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";

export const dynamic = "force-dynamic";

type ProjectionResponseItem = {
  id: string;
  title: string;
  planState: "planned" | "conditional" | "flexible";
  sourceKind: "task" | "floating_task" | "project_pull" | "queue" | "rhythm";
  environment: string | null;
  expectedActiveMinutes: number | null;
  reason: string | null;
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

function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function daysBetween(startIso: string, endIso: string) {
  const start = new Date(`${startIso}T12:00:00Z`).getTime();
  const end = new Date(`${endIso}T12:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function isSunday(dateIso: string) {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay() === 0;
}

function futureWorkdays(afterDate: string, count: number) {
  const dates: string[] = [];
  let cursor = afterDate;
  while (dates.length < count) {
    cursor = addDaysIso(cursor, 1);
    if (!isSunday(cursor)) dates.push(cursor);
  }
  return dates;
}

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function minuteTotal(items: Array<{ expectedActiveMinutes: number | null }>) {
  return items.reduce((total, item) => total + Math.max(0, Number(item.expectedActiveMinutes) || 0), 0);
}

function estimatedQueueMinutes(payload: Record<string, unknown> | null | undefined) {
  const metadata = (payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {}) as Record<string, unknown>;
  const explicit = Number(metadata.estimated_minutes);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const effort = Number(payload?.effort_units ?? metadata.effort_units);
  if (Number.isFinite(effort) && effort > 0) return Math.max(20, Math.round(effort * 15));
  return 30;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "worker-future-day-projection-v2",
    },
  });
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const viewer = atlasUniversalViewerFromSession(session);
  if (!viewer) return privateJson({ ok: false, error: "An active Atlas membership is required." }, 403);

  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  if (!validDateIso(requestedDate)) {
    return privateJson({ ok: false, error: "date must be a valid YYYY-MM-DD date." }, 400);
  }

  const dateIso = requestedDate as string;
  const today = centralDateIso();
  if (dateIso <= today) {
    return privateJson({ ok: true, active: false, date: dateIso, items: [] });
  }

  try {
    const operatorContext = await readAtlasOwnerOperatorContext();
    const effectiveMembershipId = effectiveOperatorMembershipId(operatorContext);
    const effectiveAccountId = effectiveOperatorAccountId(operatorContext);
    const effective = operatorContext?.effective ?? null;

    if (
      !operatorContext?.isOperating
      || !effectiveMembershipId
      || !effectiveAccountId
      || !effective?.farmId
      || effective.farmRole !== "farm_hand"
    ) {
      return privateJson({ ok: true, active: false, date: dateIso, items: [] });
    }

    const projectionStart = addDaysIso(today, 1);
    const withinPlanningHorizon = daysBetween(projectionStart, dateIso) >= 0 && daysBetween(projectionStart, dateIso) < 14;
    const projection = await readStoredOwnerWeekProjection(
      effective.farmId,
      effectiveMembershipId,
      withinPlanningHorizon ? projectionStart : dateIso,
      withinPlanningHorizon ? 14 : 1,
    );
    const home = await readAtlasOperatorUniversalHome(viewer, {
      doneDate: dateIso,
      dueThrough: dateIso,
      effectiveAccountId,
      effectiveMembershipId,
    });

    const actualTaskIds = new Set(atlasUniversalTaskCards(home).map((task) => task.task_id));
    const projectionDay = projection.days.find((day) => day.date === dateIso);
    const allDayItems = projectionDay?.items ?? [];
    const scheduledPaidMinutes = minuteTotal(allDayItems.filter((item) => item.sourceKind === "task"));

    const items: ProjectionResponseItem[] = allDayItems
      .filter((item) => item.sourceKind !== "task" || !actualTaskIds.has(item.sourceId))
      .map((item) => ({
        id: item.id,
        title: item.title,
        planState: item.planState,
        sourceKind: item.sourceKind,
        environment: item.environment,
        expectedActiveMinutes: item.expectedActiveMinutes,
        reason: item.reason,
      }));

    const queueResult = await atlasSupabase
      .schema("atlas")
      .from("task_release_queue_items")
      .select("position,state,planned_occurrence_id")
      .eq("farm_id", effective.farmId)
      .eq("queue_key", "anna_weeding_rotation")
      .eq("state", "queued")
      .order("position", { ascending: true });
    if (queueResult.error) throw new Error(queueResult.error.message);

    const queuedRows = (queueResult.data ?? []).filter((row) => Boolean(row.planned_occurrence_id));
    const occurrenceIds = queuedRows.map((row) => String(row.planned_occurrence_id));
    const occurrenceResult = occurrenceIds.length
      ? await atlasSupabase
          .schema("atlas")
          .from("planned_work_occurrences")
          .select("id,title,state,task_payload")
          .in("id", occurrenceIds)
      : { data: [], error: null };
    if (occurrenceResult.error) throw new Error(occurrenceResult.error.message);

    const occurrences = new Map(
      (occurrenceResult.data ?? []).map((row) => [String(row.id), row] as const),
    );
    const projectedWeedQueue = queuedRows
      .map((row) => ({ row, occurrence: occurrences.get(String(row.planned_occurrence_id)) }))
      .filter(({ occurrence }) => occurrence && !["cancelled", "completed"].includes(String(occurrence.state)));
    const projectedWeedDates = futureWorkdays(today, projectedWeedQueue.length);
    const projectedWeedIndex = projectedWeedDates.indexOf(dateIso);

    if (projectedWeedIndex >= 0 && !items.some((item) => item.sourceKind === "queue")) {
      const candidate = projectedWeedQueue[projectedWeedIndex]?.occurrence;
      if (candidate) {
        const payload = (candidate.task_payload && typeof candidate.task_payload === "object"
          ? candidate.task_payload
          : {}) as Record<string, unknown>;
        items.push({
          id: `weed-queue:${candidate.id}`,
          title: String(candidate.title || payload.title || "Weed Card"),
          planState: "conditional",
          sourceKind: "queue",
          environment: "outdoor",
          expectedActiveMinutes: estimatedQueueMinutes(payload),
          reason: "Projected Weed Card · appears only if the Weed Cards ahead of it are completed; otherwise it moves forward with the queue.",
        });
      }
    }

    const tentativePaidMinutes = minuteTotal(items.filter((item) => item.sourceKind !== "task"));
    const projectedPaidMinutes = scheduledPaidMinutes + tentativePaidMinutes;
    const paidTargetMinutes = projection.paidTargetMinutes;
    const paidGapMinutes = Math.max(0, paidTargetMinutes - projectedPaidMinutes);

    return privateJson({
      ok: true,
      active: true,
      date: dateIso,
      operatorLabel: effective.displayName,
      paidTargetMinutes,
      scheduledPaidMinutes,
      tentativePaidMinutes,
      projectedPaidMinutes,
      paidGapMinutes,
      items,
    });
  } catch (error) {
    console.error("Atlas future day projection read failed:", error);
    return privateJson({ ok: false, error: "Tentative day planning could not be loaded." }, 500);
  }
}
