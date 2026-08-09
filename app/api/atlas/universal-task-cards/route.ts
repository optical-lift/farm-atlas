import { NextResponse } from "next/server";

import {
  effectiveOperatorAccountId,
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasOperatorUniversalHome } from "@/lib/atlas/operator-universal-home";
import { getAtlasSession } from "@/lib/atlas/session";
import { readAtlasTaskDayDispositions } from "@/lib/atlas/task-day-dispositions-server";
import { readAtlasTaskMoveContexts } from "@/lib/atlas/task-move-context";
import {
  atlasUniversalPortalLabel,
  atlasUniversalTaskCards,
} from "@/lib/atlas/universal-task-cards";
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

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "universal-dated-task-cards-v4-project-moves",
    },
  });
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const viewer = atlasUniversalViewerFromSession(session);
  if (!viewer) return privateJson({ ok: false, error: "An active Atlas membership is required." }, 403);

  const url = new URL(request.url);
  const requestedDueThrough = url.searchParams.get("dueThrough");
  const requestedDoneDate = url.searchParams.get("doneDate");
  const requestedExactDate = url.searchParams.get("exactDate");
  if (requestedDueThrough && !validDateIso(requestedDueThrough)) {
    return privateJson({ ok: false, error: "dueThrough must be a valid YYYY-MM-DD date." }, 400);
  }
  if (requestedDoneDate && !validDateIso(requestedDoneDate)) {
    return privateJson({ ok: false, error: "doneDate must be a valid YYYY-MM-DD date." }, 400);
  }
  if (requestedExactDate && !validDateIso(requestedExactDate)) {
    return privateJson({ ok: false, error: "exactDate must be a valid YYYY-MM-DD date." }, 400);
  }

  const exactDate = requestedExactDate ?? undefined;
  const doneDate = requestedDoneDate ?? exactDate ?? centralDateIso();
  const dueThrough = requestedDueThrough ?? exactDate ?? addDaysIso(doneDate, 35);
  if (dueThrough < doneDate) {
    return privateJson({ ok: false, error: "The task window cannot end before its done date." }, 400);
  }
  if (exactDate && (exactDate < doneDate || exactDate > dueThrough)) {
    return privateJson({ ok: false, error: "exactDate must fall inside the requested task window." }, 400);
  }

  try {
    const operatorContext = await readAtlasOwnerOperatorContext();
    const home = await readAtlasOperatorUniversalHome(viewer, {
      doneDate,
      dueThrough,
      effectiveAccountId: effectiveOperatorAccountId(operatorContext),
      effectiveMembershipId: effectiveOperatorMembershipId(operatorContext),
    });
    const dispositions = await readAtlasTaskDayDispositions(doneDate);
    const setAsideTaskIds = new Set(dispositions.map((row) => row.taskId));

    // The server-side worker-day reader is authoritative for future-day membership.
    // It now returns both work presented for the requested day and unresolved work
    // inherited from the immediately preceding available workday. Do not throw that
    // carry-forward away merely because its original due date is earlier than the
    // future day being inspected. Historical/done rows are still constrained by the
    // worker-day reader itself.
    const baseTaskCards = atlasUniversalTaskCards(home)
      .filter((card) => !setAsideTaskIds.has(card.task_id));

    // Project context is enrichment, not a dependency of the working Day. If the
    // portfolio reader is temporarily unavailable, the executable task cards remain usable.
    let moveContexts = {} as Awaited<ReturnType<typeof readAtlasTaskMoveContexts>>;
    try {
      moveContexts = await readAtlasTaskMoveContexts(baseTaskCards.map((card) => card.task_id));
    } catch (contextError) {
      console.error("Atlas task Move context read failed:", contextError);
    }

    const taskCards = baseTaskCards.map((card) => ({
      ...card,
      move_context: moveContexts[card.task_id] ?? null,
    }));

    return privateJson({
      ok: true,
      farmKey: home.activeFarm?.farmKey || "feast_guild",
      portalLabel: atlasUniversalPortalLabel(home),
      hasFarmScope: home.viewer.hasFarmScope,
      hasOrganizationScope: home.viewer.hasOrganizationScope,
      activeFarmName: home.activeFarm?.farmName ?? null,
      role: home.activeFarm?.role ?? home.organizationHome?.viewer.role ?? null,
      operatorMode: operatorContext?.isOperating ?? false,
      effectiveAccountId: effectiveOperatorAccountId(operatorContext),
      effectiveMembershipId: effectiveOperatorMembershipId(operatorContext),
      taskCards,
      window: { doneDate, dueThrough, exactDate },
    });
  } catch (error) {
    console.error("Atlas universal dated-task read failed:", error);
    return privateJson({ ok: false, error: "Atlas dated work could not be loaded." }, 500);
  }
}
