import { NextResponse } from "next/server";

import {
  atlasDayTaskConsequence,
  atlasIsCarriedDayTask,
  atlasIsDayDenominatorExcluded,
  atlasIsDayWorkTask,
  atlasIsFlexibleDayDeal,
} from "@/lib/atlas/day-consequence";
import type { AtlasLivingDayPlan } from "@/lib/atlas/day-plan-contract";
import {
  effectiveOperatorAccountId,
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasOperatorUniversalHome } from "@/lib/atlas/operator-universal-home";
import { getAtlasSession } from "@/lib/atlas/session";
import { atlasUniversalTaskCards } from "@/lib/atlas/universal-task-cards";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";
import { atlasWorkOrderSortValue } from "@/lib/atlas/work-order";
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

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "living-day-plan-v1",
    },
  });
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const requestedDate = new URL(request.url).searchParams.get("date");
  if (requestedDate && !validDateIso(requestedDate)) {
    return privateJson({ ok: false, error: "date must be a valid YYYY-MM-DD date." }, 400);
  }
  const dateIso = requestedDate ?? centralDateIso();

  try {
    const operatorContext = await readAtlasOwnerOperatorContext();
    const farmId = operatorContext?.isOperating
      ? operatorContext.effective.farmId
      : session.activeFarmId ?? session.memberships[0]?.farmId ?? null;
    if (!farmId) return privateJson({ ok: false, error: "The selected account has no active farm membership." }, 403);

    const membershipId = effectiveOperatorMembershipId(operatorContext)
      ?? session.memberships.find((membership) => membership.farmId === farmId)?.membershipId
      ?? null;
    if (!membershipId) return privateJson({ ok: false, error: "The selected account has no Living Day membership." }, 403);

    const viewer = atlasUniversalViewerFromSession(session);
    if (!viewer) return privateJson({ ok: false, error: "An active Atlas membership is required." }, 403);

    const home = await readAtlasOperatorUniversalHome(viewer, {
      doneDate: dateIso,
      dueThrough: dateIso,
      effectiveAccountId: effectiveOperatorAccountId(operatorContext),
      effectiveMembershipId: effectiveOperatorMembershipId(operatorContext),
    });

    const supabase = await createAtlasServerClient();
    const dispositionResponse = await supabase.rpc("viewer_task_day_dispositions_v1", { p_day: dateIso });
    if (dispositionResponse.error) throw dispositionResponse.error;
    const setAsideTaskIds = new Set(
      (Array.isArray(dispositionResponse.data) ? dispositionResponse.data : [])
        .map((row) => row && typeof row === "object" && !Array.isArray(row)
          ? String((row as { taskId?: unknown }).taskId ?? "")
          : "")
        .filter(Boolean),
    );

    const cards = atlasUniversalTaskCards(home)
      .filter((card) => !setAsideTaskIds.has(card.task_id))
      .filter(atlasIsDayWorkTask);

    const dueCards = cards
      .filter((card) => card.due_date === dateIso)
      .sort((a, b) => atlasWorkOrderSortValue(a).localeCompare(atlasWorkOrderSortValue(b)));

    const carriedCards = cards
      .filter((card) => card.status === "open" || card.status === "blocked")
      .filter((card) => Boolean(card.due_date && card.due_date <= dateIso))
      .filter((card) => atlasIsCarriedDayTask(card, dateIso))
      .sort((a, b) => {
        const aConsequence = atlasDayTaskConsequence(a, dateIso);
        const bConsequence = atlasDayTaskConsequence(b, dateIso);
        const rank = (kind: string | undefined) => kind === "overdue" ? 0 : kind === "continued" ? 1 : 2;
        return rank(aConsequence?.kind) - rank(bConsequence?.kind)
          || `${a.due_date ?? ""}-${atlasWorkOrderSortValue(a)}`.localeCompare(`${b.due_date ?? ""}-${atlasWorkOrderSortValue(b)}`);
      });

    const ordinaryDueCards = dueCards
      .filter((card) => !atlasIsDayDenominatorExcluded(card))
      .filter((card) => !atlasIsCarriedDayTask(card, dateIso));
    const flexibleCards = ordinaryDueCards.filter(atlasIsFlexibleDayDeal);

    const { data, error } = await supabase.rpc("prepare_living_day_plan_v1", {
      p_farm_id: farmId,
      p_membership_id: membershipId,
      p_day: dateIso,
      p_candidate_task_ids: ordinaryDueCards.map((card) => card.task_id),
      p_flexible_task_ids: flexibleCards.map((card) => card.task_id),
      p_carryover_task_ids: carriedCards.map((card) => card.task_id),
    });
    if (error) throw error;

    return privateJson({
      ok: true,
      plan: data as AtlasLivingDayPlan,
      operatorMode: operatorContext?.isOperating ?? false,
    });
  } catch (error) {
    console.error("Atlas Living Day plan read failed:", error);
    return privateJson({ ok: false, error: "The finite Living Day plan could not be loaded." }, 500);
  }
}
