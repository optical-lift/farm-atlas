import { NextResponse } from "next/server";

import { readOwnerWeekProjection } from "@/lib/atlas-data/owner-week-projection";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { getAtlasSession } from "@/lib/atlas/session";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";

export const dynamic = "force-dynamic";

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

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function minuteTotal(items: Array<{ expectedActiveMinutes: number | null }>) {
  return items.reduce((total, item) => total + Math.max(0, Number(item.expectedActiveMinutes) || 0), 0);
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "owner-operator-week-projection-v1",
    },
  });
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const viewer = atlasUniversalViewerFromSession(session);
  if (!viewer) return privateJson({ ok: false, error: "An active Atlas membership is required." }, 403);

  const url = new URL(request.url);
  const requestedStart = url.searchParams.get("start");
  const requestedEnd = url.searchParams.get("end");
  if (!validDateIso(requestedStart) || !validDateIso(requestedEnd)) {
    return privateJson({ ok: false, error: "start and end must be valid YYYY-MM-DD dates." }, 400);
  }

  const start = requestedStart as string;
  const end = requestedEnd as string;
  const span = daysBetween(start, end);
  if (span < 0 || span > 13) {
    return privateJson({ ok: false, error: "Owner week projection supports a 1–14 day range." }, 400);
  }

  try {
    const operatorContext = await readAtlasOwnerOperatorContext();
    const effectiveMembershipId = effectiveOperatorMembershipId(operatorContext);
    const effective = operatorContext?.effective ?? null;

    if (
      !operatorContext?.isOperating
      || !effectiveMembershipId
      || !effective?.farmId
      || effective.farmRole !== "farm_hand"
    ) {
      return privateJson({ ok: true, active: false, start, end, days: [] });
    }

    const today = centralDateIso();
    const firstFuture = addDaysIso(today, 1);
    const projectionStart = start > firstFuture ? start : firstFuture;
    if (end < projectionStart) {
      return privateJson({ ok: true, active: true, start, end, operatorLabel: effective.displayName, paidTargetMinutes: 0, days: [] });
    }

    const dayCount = daysBetween(projectionStart, end) + 1;
    const projection = await readOwnerWeekProjection(
      effective.farmId,
      effectiveMembershipId,
      projectionStart,
      dayCount,
    );

    const days = projection.days.map((day) => {
      const scheduledItems = day.items.filter((item) => item.sourceKind === "task");
      const fillItems = day.items.filter((item) => item.sourceKind !== "task");
      const scheduledPaidMinutes = minuteTotal(scheduledItems);
      const tentativePaidMinutes = minuteTotal(fillItems);
      const projectedPaidMinutes = scheduledPaidMinutes + tentativePaidMinutes;
      return {
        date: day.date,
        scheduledPaidMinutes,
        tentativePaidMinutes,
        projectedPaidMinutes,
        paidGapMinutes: Math.max(0, projection.paidTargetMinutes - projectedPaidMinutes),
        items: fillItems.map((item) => ({
          id: item.id,
          title: item.title,
          planState: item.planState,
          sourceKind: item.sourceKind,
          environment: item.environment,
          expectedActiveMinutes: item.expectedActiveMinutes,
          reason: item.reason,
        })),
      };
    });

    return privateJson({
      ok: true,
      active: true,
      start,
      end,
      operatorLabel: effective.displayName,
      paidTargetMinutes: projection.paidTargetMinutes,
      days,
    });
  } catch (error) {
    console.error("Atlas Owner week projection read failed:", error);
    return privateJson({ ok: false, error: "Owner week planning could not be loaded." }, 500);
  }
}
