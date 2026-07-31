import "server-only";

import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import type { AtlasTaskDayDisposition } from "@/lib/atlas/task-set-aside-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export async function readAtlasTaskDayDispositions(day: string): Promise<AtlasTaskDayDisposition[]> {
  const operatorContext = await readAtlasOwnerOperatorContext();
  const effectiveMembershipId = effectiveOperatorMembershipId(operatorContext);
  const supabase = await createAtlasServerClient();
  const response = effectiveMembershipId
    ? await supabase.rpc("owner_operator_task_day_dispositions_v1", {
        p_effective_membership_id: effectiveMembershipId,
        p_day: day,
      })
    : await supabase.rpc("viewer_task_day_dispositions_v1", {
        p_day: day,
      });
  const { data, error } = response;
  if (error) throw new Error(error.message || "Atlas task day dispositions could not be read.");
  return Array.isArray(data) ? data as AtlasTaskDayDisposition[] : [];
}

export async function readAtlasSetAsideTaskIds(day: string) {
  const rows = await readAtlasTaskDayDispositions(day);
  return new Set(rows.map((row) => row.taskId));
}
