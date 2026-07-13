import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayIso();
  const daysValue = Number(request.nextUrl.searchParams.get("days") ?? "1");
  const days = Number.isInteger(daysValue) ? Math.min(7, Math.max(1, daysValue)) : 1;

  const { data, error } = await atlasSupabase.schema("atlas").rpc("preview_unified_maintenance_plan", {
    p_farm_key: "elm_farm",
    p_start_date: date,
    p_days: days,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: "Unified maintenance plan failed.", details: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, farmKey: "elm_farm", date, days, items: data ?? [] });
}
