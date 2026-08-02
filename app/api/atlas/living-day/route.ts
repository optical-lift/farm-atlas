import { NextResponse } from "next/server";

import type { AtlasJournalDay } from "@/lib/atlas/journal-contract";
import type { AtlasLivingDay } from "@/lib/atlas/living-day-contract";
import { readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { getAtlasSession, membershipForFarm } from "@/lib/atlas/session";
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
      "X-Atlas-Read-Path": "living-day-v1",
    },
  });
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const farmId = operatorContext?.isOperating
    ? operatorContext.effective.farmId
    : session.activeFarmId ?? session.memberships[0]?.farmId ?? null;
  if (!farmId) return privateJson({ ok: false, error: "The selected account has no active farm membership." }, 403);

  const effectiveMembershipId = operatorContext?.isOperating
    ? operatorContext.effective.farmMembershipId
    : membershipForFarm(session, farmId)?.membershipId ?? null;
  if (!effectiveMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no readable farm membership." }, 403);
  }

  const requestedDate = new URL(request.url).searchParams.get("date");
  if (requestedDate && !validDateIso(requestedDate)) {
    return privateJson({ ok: false, error: "date must be a valid YYYY-MM-DD date." }, 400);
  }
  const dateIso = requestedDate ?? centralDateIso();

  try {
    const supabase = await createAtlasServerClient();
    const [livingDayResult, journalResult] = await Promise.all([
      supabase.rpc("living_day_v1", {
        p_farm_id: farmId,
        p_day: dateIso,
      }),
      supabase.rpc("journal_day_for_membership_v1", {
        p_farm_id: farmId,
        p_membership_id: effectiveMembershipId,
        p_day: dateIso,
      }),
    ]);
    if (livingDayResult.error) throw livingDayResult.error;
    if (journalResult.error) throw journalResult.error;

    const livingDay = livingDayResult.data as AtlasLivingDay;
    const journal = journalResult.data as AtlasJournalDay;
    const effectiveLivingDay: AtlasLivingDay = {
      ...livingDay,
      journal,
      completionSummary: {
        ...livingDay.completionSummary,
        plannedOpen: journal.summary.open,
        plannedDone: journal.summary.done,
      },
      ownerDecisions: operatorContext?.isOperating && operatorContext.effective.farmRole !== "owner"
        ? []
        : livingDay.ownerDecisions,
    };

    return privateJson({
      ok: true,
      livingDay: effectiveLivingDay,
      operatorMode: operatorContext?.isOperating ?? false,
      presentationContract: "presented_work_v1",
    });
  } catch (error) {
    console.error("Atlas Living Day read failed:", error);
    return privateJson({ ok: false, error: "The Living Day could not be loaded." }, 500);
  }
}
