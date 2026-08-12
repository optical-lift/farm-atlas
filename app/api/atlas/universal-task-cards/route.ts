import { NextResponse } from "next/server";

import { atlasFarmDateIso, atlasShiftFarmDate } from "@/lib/atlas/farm-day";
import {
  effectiveOperatorAccountId,
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasOperatorUniversalHome } from "@/lib/atlas/operator-universal-home";
import { getAtlasSession } from "@/lib/atlas/session";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { readAtlasTaskDayDispositions } from "@/lib/atlas/task-day-dispositions-server";
import { readAtlasTaskMoveContexts } from "@/lib/atlas/task-move-context";
import {
  atlasUniversalPortalLabel,
  atlasUniversalTaskCards,
} from "@/lib/atlas/universal-task-cards";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";
import { workerExecutionTaskCards } from "@/lib/atlas/worker-execution-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TaskCardRow = { task_id: string; due_date?: string | null; metadata?: Record<string, unknown> | null; [key: string]: unknown };
type DayPlacement = {
  taskId: string;
  serviceDate: string;
  dayWindow: "morning" | "afternoon" | "evening";
  sortOrder: number;
  placementSource: "atlas" | "owner";
  placementReason: string | null;
  state: "placed" | "returned_to_atlas";
};

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "universal-dated-task-cards-v5-day-placement",
    },
  });
}

function dayPlacement(value: unknown): DayPlacement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.taskId !== "string" || typeof row.serviceDate !== "string") return null;
  if (row.dayWindow !== "morning" && row.dayWindow !== "afternoon" && row.dayWindow !== "evening") return null;
  return {
    taskId: row.taskId,
    serviceDate: row.serviceDate,
    dayWindow: row.dayWindow,
    sortOrder: Number(row.sortOrder) || 0,
    placementSource: row.placementSource === "owner" ? "owner" : "atlas",
    placementReason: typeof row.placementReason === "string" && row.placementReason.trim() ? row.placementReason : null,
    state: row.state === "returned_to_atlas" ? "returned_to_atlas" : "placed",
  };
}

function placementAnchor(window: DayPlacement["dayWindow"]) {
  if (window === "morning") return "morning";
  if (window === "afternoon") return "midday";
  return "evening";
}

function applyDayPlacement(card: TaskCardRow, placement: DayPlacement) {
  return {
    ...card,
    // Day placement changes where the worker encounters this move, not the
    // canonical task due_date stored in Atlas. Task Focus still reads task truth.
    due_date: placement.serviceDate,
    metadata: {
      ...(card.metadata ?? {}),
      canonical_due_date: card.due_date ?? null,
      owner_day_window_override: placement.dayWindow,
      work_order_anchor: placementAnchor(placement.dayWindow),
      day_work_order: placement.sortOrder,
      day_placement: {
        serviceDate: placement.serviceDate,
        dayWindow: placement.dayWindow,
        sortOrder: placement.sortOrder,
        placementSource: placement.placementSource,
        placementReason: placement.placementReason,
      },
    },
  };
}

function baselineSurvivesPlacement(placement: DayPlacement, placementDay: string) {
  if (placement.state === "returned_to_atlas") {
    // Return to Atlas removes the task from the Day it was handed back. On a
    // later workday the ordinary eligibility/carry engine is free to offer it.
    return placement.serviceDate !== placementDay;
  }
  if (placement.serviceDate === placementDay) return true;
  // Before an explicit future placement, keep the task off the worker's plate.
  // After a missed explicit placement, ordinary overdue/carry behavior resumes.
  return placement.serviceDate < placementDay;
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
  const doneDate = requestedDoneDate ?? exactDate ?? atlasFarmDateIso();
  const dueThrough = requestedDueThrough ?? exactDate ?? atlasShiftFarmDate(doneDate, 35);
  if (dueThrough < doneDate) {
    return privateJson({ ok: false, error: "The task window cannot end before its done date." }, 400);
  }
  if (exactDate && (exactDate < doneDate || exactDate > dueThrough)) {
    return privateJson({ ok: false, error: "exactDate must fall inside the requested task window." }, 400);
  }

  // Day currently sends an exactDate only for future dates. An equal one-day
  // done/due window is also a Day-sized request, so placements govern today too.
  const placementDay = exactDate ?? (requestedDoneDate && requestedDueThrough === requestedDoneDate ? requestedDoneDate : null);

  try {
    const operatorContext = await readAtlasOwnerOperatorContext();
    const effectiveMembershipId = effectiveOperatorMembershipId(operatorContext);
    const home = await readAtlasOperatorUniversalHome(viewer, {
      doneDate,
      dueThrough,
      effectiveAccountId: effectiveOperatorAccountId(operatorContext),
      effectiveMembershipId,
    });
    const dispositions = await readAtlasTaskDayDispositions(doneDate);
    const setAsideTaskIds = new Set(dispositions.map((row) => row.taskId));

    // The server-side worker-day reader remains authoritative for ordinary day
    // membership. Explicit Owner placement is a narrow override layered on top.
    let baseTaskCards = atlasUniversalTaskCards(home)
      .filter((card) => !setAsideTaskIds.has(card.task_id)) as TaskCardRow[];

    const workerMembershipId = effectiveMembershipId
      ?? (home.activeFarm?.role === "farm_hand" ? home.activeFarm.membershipId : null);
    const workerFarmId = home.activeFarm?.farmId ?? null;

    if (placementDay && workerMembershipId && workerFarmId) {
      const supabase = await createAtlasServerClient();
      const [choreographyResponse, placedCardsResponse] = await Promise.all([
        supabase.rpc("worker_day_choreography_api_v1", {
          p_farm_id: workerFarmId,
          p_membership_id: workerMembershipId,
          p_day: placementDay,
        }),
        supabase.rpc("worker_day_placed_task_cards_v1", {
          p_farm_id: workerFarmId,
          p_membership_id: workerMembershipId,
          p_day: placementDay,
        }),
      ]);

      if (choreographyResponse.error) throw new Error(choreographyResponse.error.message);
      if (placedCardsResponse.error) throw new Error(placedCardsResponse.error.message);

      const choreography = choreographyResponse.data && typeof choreographyResponse.data === "object" && !Array.isArray(choreographyResponse.data)
        ? choreographyResponse.data as Record<string, unknown>
        : {};
      const overrideRows = Array.isArray(choreography.placementOverrides) ? choreography.placementOverrides : [];
      const overrides = new Map<string, DayPlacement>();
      for (const value of overrideRows) {
        const placement = dayPlacement(value);
        if (placement) overrides.set(placement.taskId, placement);
      }

      baseTaskCards = baseTaskCards
        .filter((card) => {
          const placement = overrides.get(card.task_id);
          return placement ? baselineSurvivesPlacement(placement, placementDay) : true;
        })
        .map((card) => {
          const placement = overrides.get(card.task_id);
          return placement?.state === "placed" && placement.serviceDate === placementDay
            ? applyDayPlacement(card, placement)
            : card;
        });

      const seen = new Set(baseTaskCards.map((card) => card.task_id));
      const placedRows = Array.isArray(placedCardsResponse.data) ? placedCardsResponse.data as TaskCardRow[] : [];
      for (const card of placedRows) {
        if (seen.has(card.task_id) || setAsideTaskIds.has(card.task_id)) continue;
        const placement = overrides.get(card.task_id);
        if (!placement || placement.state !== "placed" || placement.serviceDate !== placementDay) continue;
        baseTaskCards.push(applyDayPlacement(card, placement));
        seen.add(card.task_id);
      }
    }

    // Project context is enrichment, not a dependency of the working Day. If the
    // portfolio reader is temporarily unavailable, the executable task cards remain usable.
    let moveContexts = {} as Awaited<ReturnType<typeof readAtlasTaskMoveContexts>>;
    try {
      moveContexts = await readAtlasTaskMoveContexts(baseTaskCards.map((card) => card.task_id));
    } catch (contextError) {
      console.error("Atlas task Move context read failed:", contextError);
    }

    const enrichedTaskCards = baseTaskCards.map((card) => ({
      ...card,
      move_context: moveContexts[card.task_id] ?? null,
    })) as AtlasTaskCard[];
    const effectiveRole = effectiveMembershipId
      ? operatorContext?.effective.farmRole ?? operatorContext?.effective.role ?? null
      : home.activeFarm?.role ?? home.organizationHome?.viewer.role ?? null;
    const taskCards = effectiveRole === "farm_hand"
      ? workerExecutionTaskCards(enrichedTaskCards)
      : enrichedTaskCards;

    return privateJson({
      ok: true,
      farmKey: home.activeFarm?.farmKey || "feast_guild",
      portalLabel: atlasUniversalPortalLabel(home),
      hasFarmScope: home.viewer.hasFarmScope,
      hasOrganizationScope: home.viewer.hasOrganizationScope,
      activeFarmName: home.activeFarm?.farmName ?? null,
      role: effectiveRole,
      operatorMode: operatorContext?.isOperating ?? false,
      effectiveAccountId: effectiveOperatorAccountId(operatorContext),
      effectiveMembershipId,
      taskCards,
      window: { doneDate, dueThrough, exactDate, placementDay },
    });
  } catch (error) {
    console.error("Atlas universal dated-task read failed:", error);
    return privateJson({ ok: false, error: "Atlas dated work could not be loaded." }, 500);
  }
}
