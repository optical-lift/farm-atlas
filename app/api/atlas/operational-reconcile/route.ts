import { NextRequest, NextResponse } from "next/server";

import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, error: "Operational reconciliation requires a same-origin request." }, { status: 403 });
    }
    if (request.headers.get("x-atlas-intent") !== "operational-reconcile-v1") {
      return NextResponse.json({ ok: false, error: "Operational reconciliation intent is required." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { anchorDate?: string; days?: number };
    const anchorDate = body.anchorDate?.trim() || new Date().toISOString().slice(0, 10);
    const days = Number.isInteger(body.days) ? Number(body.days) : 31;

    if (!validDate(anchorDate)) {
      return NextResponse.json({ ok: false, error: "Choose a valid reconciliation date." }, { status: 400 });
    }
    if (days < 1 || days > 93) {
      return NextResponse.json({ ok: false, error: "Reconciliation days must be between 1 and 93." }, { status: 400 });
    }

    const { data, error } = await atlasSupabase.schema("atlas").rpc("reconcile_operational_work_v1", {
      p_farm_key: "elm_farm",
      p_anchor_date: anchorDate,
      p_days: days,
    });

    if (error) {
      console.error("Atlas operational reconciliation failed:", error);
      return NextResponse.json({ ok: false, error: "Atlas could not refresh operational work.", details: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, result: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Atlas operational reconciliation route failed:", error);
    return NextResponse.json(
      { ok: false, error: "Atlas operational reconciliation failed.", details: error instanceof Error ? error.message : "Unknown error." },
      { status: 500 },
    );
  }
}
