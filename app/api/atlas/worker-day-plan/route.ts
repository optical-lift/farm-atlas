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
      "X-Atlas-Read-Path": "canonical-owner-worker-day-plan-v1",
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
    return privateJson({ ok: true, date: dateIso, ...result });
  } catch (error) {
    console.error("Atlas canonical worker day plan failed:", error);
    return privateJson({ ok: false, error: "Atlas could not resolve this worker day." }, 500);
  }
}
