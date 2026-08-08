import { NextResponse } from "next/server";

import { readOwnerWeekProjection } from "@/lib/atlas-data/owner-week-projection";
import {
  effectiveOperatorAccountId,
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasOperatorUniversalHome } from "@/lib/atlas/operator-universal-home";
import { getAtlasSession } from "@/lib/atlas/session";
import { atlasUniversalTaskCards } from "@/lib/atlas/universal-task-cards";
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

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "owner-operator-day-projection-v1",
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
  if (dateIso <= centralDateIso()) {
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

    const [projection, home] = await Promise.all([
      readOwnerWeekProjection(effective.farmId, effectiveMembershipId, dateIso, 1),
      readAtlasOperatorUniversalHome(viewer, {
        doneDate: dateIso,
        dueThrough: dateIso,
        effectiveAccountId,
        effectiveMembershipId,
      }),
    ]);

    const actualTaskIds = new Set(atlasUniversalTaskCards(home).map((task) => task.task_id));
    const items = (projection.days[0]?.items ?? [])
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

    return privateJson({
      ok: true,
      active: true,
      date: dateIso,
      operatorLabel: effective.displayName,
      items,
    });
  } catch (error) {
    console.error("Atlas Owner day projection read failed:", error);
    return privateJson({ ok: false, error: "Tentative day planning could not be loaded." }, 500);
  }
}
