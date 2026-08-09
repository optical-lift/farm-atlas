import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { readOwnerWorkerDayPlan } from "@/lib/atlas/worker-day-plan-server";

export const dynamic = "force-dynamic";

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Read-Path": "owner-worker-day-plan-compat-suggestions-v1",
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
    const result = await readOwnerWorkerDayPlan(dateIso as string);
    if (!result.active || !result.plan) return privateJson({ ok: true, active: false, date: dateIso, candidates: [] });
    const plan = result.plan;
    return privateJson({
      ok: true,
      active: true,
      date: dateIso,
      operatorLabel: result.operatorLabel,
      paidTargetMinutes: plan.paidTargetMinutes,
      scheduledPaidMinutes: plan.committedPaidMinutes,
      approvedConditionalMinutes: 0,
      committedPaidMinutes: plan.committedPaidMinutes,
      remainingPaidMinutes: plan.remainingPaidMinutes,
      candidates: plan.suggestions.map((candidate) => ({ ...candidate, approved: false })),
      warnings: plan.warnings,
    });
  } catch (error) {
    console.error("Atlas owner-day projection compatibility read failed:", error);
    return privateJson({ ok: false, error: "Atlas could not load schedule ideas for this day." }, 500);
  }
}
