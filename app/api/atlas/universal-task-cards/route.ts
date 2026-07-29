import { NextResponse } from "next/server";

import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasOperatorUniversalHome } from "@/lib/atlas/operator-universal-home";
import { getAtlasSession } from "@/lib/atlas/session";
import {
  atlasUniversalPortalLabel,
  atlasUniversalTaskCards,
} from "@/lib/atlas/universal-task-cards";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";
import { createAtlasServerClient } from "@/lib/supabase/server";

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
      "X-Atlas-Read-Path": "universal-dated-task-cards-v1",
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
  if (requestedDueThrough && !validDateIso(requestedDueThrough)) {
    return privateJson({ ok: false, error: "dueThrough must be a valid YYYY-MM-DD date." }, 400);
  }
  if (requestedDoneDate && !validDateIso(requestedDoneDate)) {
    return privateJson({ ok: false, error: "doneDate must be a valid YYYY-MM-DD date." }, 400);
  }

  const doneDate = requestedDoneDate ?? centralDateIso();
  const dueThrough = requestedDueThrough ?? addDaysIso(doneDate, 35);
  if (dueThrough < doneDate) {
    return privateJson({ ok: false, error: "The task window cannot end before its done date." }, 400);
  }

  try {
    const operatorContext = await readAtlasOwnerOperatorContext();
    const home = await readAtlasOperatorUniversalHome(viewer, {
      doneDate,
      dueThrough,
      effectiveMembershipId: effectiveOperatorMembershipId(operatorContext),
    });
    const supabase = await createAtlasServerClient();
    const dispositionResponse = await supabase.rpc("viewer_task_day_dispositions_v1", {
      p_day: doneDate,
    });
    if (dispositionResponse.error) throw dispositionResponse.error;
    const setAsideTaskIds = new Set(
      (Array.isArray(dispositionResponse.data) ? dispositionResponse.data : [])
        .map((row) => row && typeof row === "object" && !Array.isArray(row) ? String((row as { taskId?: unknown }).taskId ?? "") : "")
        .filter(Boolean),
    );
    const taskCards = atlasUniversalTaskCards(home).filter((card) => !setAsideTaskIds.has(card.task_id));
    return privateJson({
      ok: true,
      farmKey: home.activeFarm?.farmKey || "feast_guild",
      portalLabel: atlasUniversalPortalLabel(home),
      hasFarmScope: home.viewer.hasFarmScope,
      hasOrganizationScope: home.viewer.hasOrganizationScope,
      activeFarmName: home.activeFarm?.farmName ?? null,
      role: home.activeFarm?.role ?? null,
      operatorMode: operatorContext?.isOperating ?? false,
      effectiveMembershipId: operatorContext?.isOperating ? operatorContext.effective.membershipId : null,
      taskCards,
      window: { doneDate, dueThrough },
    });
  } catch (error) {
    console.error("Atlas universal dated-task read failed:", error);
    return privateJson({ ok: false, error: "Atlas dated work could not be loaded." }, 500);
  }
}
