import { NextRequest, NextResponse } from "next/server";

import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function validIsoDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(request: NextRequest) {
  const startDateParam = request.nextUrl.searchParams.get("startDate");
  const daysParam = Number(request.nextUrl.searchParams.get("days") ?? "7");
  const maintenanceType = request.nextUrl.searchParams.get("maintenanceType") || "weed";
  const startDate = validIsoDate(startDateParam) ? startDateParam! : todayIso();
  const days = Number.isInteger(daysParam) ? Math.min(14, Math.max(1, daysParam)) : 7;

  const { data, error } = await atlasSupabase
    .schema("atlas")
    .rpc("preview_maintenance_schedule", {
      p_farm_key: "elm_farm",
      p_start_date: startDate,
      p_days: days,
      p_maintenance_type: maintenanceType,
    });

  if (error) {
    console.error("Atlas maintenance preview failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Atlas maintenance preview failed.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    farmKey: "elm_farm",
    maintenanceType,
    startDate,
    days,
    previewOnly: true,
    items: data ?? [],
  });
}
