import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { resolveOwnerWorkerDayPlanningTargetForSession } from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Read-Path": "worker-weekly-farm-contract-v1",
    },
  });
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const url = new URL(request.url);
  const dateIso = url.searchParams.get("date");
  if (!validDateIso(dateIso)) return privateJson({ ok: false, error: "date must be YYYY-MM-DD." }, 400);

  try {
    const target = await resolveOwnerWorkerDayPlanningTargetForSession(session);
    if (!target) return privateJson({ ok: false, error: "Owner worker-day planning access is required." }, 403);

    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("owner_weekly_farm_contract_api_v1", {
      p_farm_id: target.farmId,
      p_membership_id: target.membershipId,
      p_anchor_day: dateIso,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : 500;
      if (status === 500) console.error("Atlas Weekly Farm Contract failed:", error);
      return privateJson({ ok: false, error: status === 500 ? "Atlas could not resolve the Weekly Farm Contract." : error.message }, status);
    }

    return privateJson({ ok: true, date: dateIso, contract: data });
  } catch (error) {
    console.error("Atlas Weekly Farm Contract route failed:", error);
    return privateJson({ ok: false, error: "Atlas could not resolve the Weekly Farm Contract." }, 500);
  }
}
