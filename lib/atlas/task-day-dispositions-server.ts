import "server-only";

import type { AtlasTaskDayDisposition } from "@/lib/atlas/task-set-aside-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export async function readAtlasTaskDayDispositions(day: string): Promise<AtlasTaskDayDisposition[]> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("viewer_task_day_dispositions_v1", {
    p_day: day,
  });
  if (error) throw new Error(error.message || "Atlas task day dispositions could not be read.");
  return Array.isArray(data) ? data as AtlasTaskDayDisposition[] : [];
}

export async function readAtlasSetAsideTaskIds(day: string) {
  const rows = await readAtlasTaskDayDispositions(day);
  return new Set(rows.map((row) => row.taskId));
}
