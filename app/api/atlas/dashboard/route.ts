import { NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type DashboardZoneRow = {
  farm_key: string;
  zone_id: string;
  zone_key: string;
  zone_label: string;
  zone_type: string | null;
  mode_bias: string | null;
  goal_text: string | null;
  current_state: string | null;
  weed_pressure: string | null;
  water_status: string | null;
  visible_to_guests: boolean | null;
  sort_order: number | null;
  object_count: number | null;
  active_content_count: number | null;
  open_task_count: number | null;
  blocked_task_count: number | null;
  last_log_date: string | null;
};

export async function GET() {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("v_dashboard_zones")
    .select("*")
    .eq("farm_key", "elm_farm")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Atlas dashboard read failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Atlas dashboard read failed.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    farmKey: "elm_farm",
    zones: (data ?? []) as DashboardZoneRow[],
  });
}