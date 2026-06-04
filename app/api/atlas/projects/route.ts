import { NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type AtlasProjectCardRow = {
  farm_key: string;

  project_id: string;
  project_key: string;
  project_title: string;
  project_status: string;
  project_goal_text: string | null;
  sort_order: number | null;
  project_metadata: Record<string, unknown> | null;

  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;

  project_goal_id: string | null;
  project_goal_key: string | null;
  goal_type: string | null;
  goal_label: string | null;
  target_window_label: string | null;
  target_start_date: string | null;
  target_due_date: string | null;
  planning_status: string | null;
  success_definition: string | null;
  goal_notes: string | null;
  goal_metadata: Record<string, unknown> | null;

  step_count: number | null;
  done_step_count: number | null;
  blocked_step_count: number | null;
  task_count: number | null;
  open_task_count: number | null;
  blocked_task_count: number | null;
  next_due_date: string | null;

  steps: Array<{
    step_id: string;
    step_order: number;
    step_title: string;
    step_status: string;
    step_note: string | null;
    task_id: string | null;
    task_title: string | null;
    task_type: string | null;
    task_status: string | null;
    task_priority: string | null;
    task_due_date: string | null;
    unlock_text: string | null;
    blocker_text: string | null;
  }>;
};

export async function GET() {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("v_project_cards")
    .select("*")
    .eq("farm_key", "elm_farm")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Atlas project cards read failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Atlas project cards read failed.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    farmKey: "elm_farm",
    projects: (data ?? []) as AtlasProjectCardRow[],
  });
}