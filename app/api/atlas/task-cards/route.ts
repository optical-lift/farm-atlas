import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type AtlasTaskCardRow = {
  farm_key: string;

  task_id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  note: string | null;
  generated_from: string | null;
  generated_from_id: string | null;
  created_at: string;
  updated_at: string;

  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;

task_logs: Array<{
  field_log_id: string;
  log_date: string;
  action_types: string[];
  summary_sentence: string;
  note: string | null;
  created_at: string;
}>;

  objects: Array<{
    object_id: string;
    object_key: string;
    object_label: string;
    object_type: string;
    object_mode: string | null;
  }>;

  resource_requirements: Array<{
    requirement_id: string;
    requirement_role: string;
    requirement_source: string;
    quantity_needed: number | null;
    unit: string | null;
    status: string;
    note: string | null;
    resource_key: string | null;
    resource_label: string | null;
    resource_type: string | null;
    resource_category: string | null;
    resource_status: string | null;
    resource_quantity: number | null;
    resource_unit: string | null;
    condition_notes: string | null;
    restock_needed: boolean | null;
  }>;

  action_templates: Array<{
    template_id: string;
    template_key: string;
    template_label: string;
    action_type: string;
    required_resource_categories: string[];
    optional_resource_categories: string[];
    required_resource_keys: string[];
    optional_resource_keys: string[];
    creates_follow_up_task_types: string[];
    hard_parts: string[];
    unlocks: string[];
    card_language: string | null;
  }>;
};

export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get("taskId");

  let query = atlasSupabase
    .schema("atlas")
    .from("v_task_cards")
    .select("*")
    .eq("farm_key", "elm_farm")
    .order("due_date", { ascending: true });

  if (taskId) {
    query = query.eq("task_id", taskId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Atlas task cards read failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Atlas task cards read failed.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    farmKey: "elm_farm",
    taskCards: (data ?? []) as AtlasTaskCardRow[],
  });
}