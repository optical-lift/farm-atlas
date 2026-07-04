import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type RhythmRow = {
  id: string;
  stable_key: string;
  season_key: string;
  season_label: string;
  weekday: number;
  sort_order: number;
  work_key: string;
  display_label: string;
  default_zone_keys: string[];
  default_duration_minutes: number | null;
  weather_rule: string | null;
  source_note: string | null;
  metadata: Record<string, unknown> | null;
};

function dateIsoFromRequest(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("date");
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested;
  return new Date().toISOString().slice(0, 10);
}

function weekdayForIso(dateIso: string) {
  return new Date(`${dateIso}T12:00:00`).getDay();
}

export async function GET(request: NextRequest) {
  const dateIso = dateIsoFromRequest(request);
  const weekday = weekdayForIso(dateIso);

  const { data: farm, error: farmError } = await atlasSupabase
    .schema("atlas")
    .from("farms")
    .select("id")
    .eq("stable_key", "elm_farm")
    .single();

  if (farmError || !farm) {
    return NextResponse.json(
      { ok: false, error: "Elm Farm was not found.", details: farmError?.message },
      { status: 500 },
    );
  }

  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("rhythm_templates")
    .select("id, stable_key, season_key, season_label, weekday, sort_order, work_key, display_label, default_zone_keys, default_duration_minutes, weather_rule, source_note, metadata")
    .eq("farm_id", farm.id)
    .eq("active", true)
    .lte("start_date", dateIso)
    .gte("end_date", dateIso)
    .eq("weekday", weekday)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Atlas rhythm read failed.", details: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as RhythmRow[];
  const blocks = rows.map((row) => ({
    ...row,
    cue: typeof row.metadata?.cue === "string" ? row.metadata.cue : null,
  }));

  return NextResponse.json({
    ok: true,
    farmKey: "elm_farm",
    date: dateIso,
    seasonLabel: blocks[0]?.season_label ?? null,
    blocks,
  });
}
