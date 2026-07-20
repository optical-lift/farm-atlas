import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasOwnerTaskRow = {
  id: string;
  farm_id: string;
  zone_id: string | null;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  completed_at: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
  parent_task_id: string | null;
};

export async function getOwnerTaskRows(farmId: string): Promise<AtlasOwnerTaskRow[]> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, farm_id, zone_id, title, task_type, status, priority, due_date, unlock_text, blocker_text, completed_at, note, metadata, updated_at, parent_task_id",
    )
    .eq("farm_id", farmId)
    .eq("metadata->>owner_task", "true")
    .in("status", ["open", "blocked", "done"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) throw new Error("Atlas Owner task read failed.");
  return (data ?? []) as AtlasOwnerTaskRow[];
}
