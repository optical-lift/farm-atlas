import { NextResponse } from "next/server";

import { atlasApiError, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim() ?? "";
  if (!UUID_PATTERN.test(taskId)) return atlasApiError(400, "task_bed_map_task_required", "A valid task is required.");

  const supabase = await createAtlasServerClient();
  const { data: task, error: taskError } = await supabase
    .schema("atlas")
    .from("tasks")
    .select("id,metadata")
    .eq("id", taskId)
    .limit(1)
    .maybeSingle();
  if (taskError) return atlasApiError(500, "task_bed_map_task_failed", "Atlas could not read the task target.");
  if (!task) return atlasApiError(404, "task_bed_map_task_not_found", "The task was not found.");

  let objectId = "";
  const { data: links, error: linkError } = await supabase
    .schema("atlas")
    .from("task_objects")
    .select("object_id,role,growing_objects!inner(object_type)")
    .eq("task_id", taskId);
  if (linkError) return atlasApiError(500, "task_bed_map_target_failed", "Atlas could not read the task target.");

  const bedLink = (links ?? []).find((row) => {
    const object = row.growing_objects as unknown as { object_type?: string | null } | null;
    return text(object?.object_type) === "bed" && row.role === "target";
  }) ?? (links ?? []).find((row) => {
    const object = row.growing_objects as unknown as { object_type?: string | null } | null;
    return text(object?.object_type) === "bed";
  });
  objectId = text(bedLink?.object_id);

  if (!objectId) {
    const metadata = (task.metadata ?? {}) as Record<string, unknown>;
    const cropCycleId = text(metadata.crop_cycle_id);
    if (UUID_PATTERN.test(cropCycleId)) {
      const { data: cycle } = await supabase.schema("atlas").from("crop_cycles").select("object_id").eq("id", cropCycleId).limit(1).maybeSingle();
      objectId = text(cycle?.object_id);
    }
  }

  if (!objectId) return NextResponse.json({ ok: true, map: null }, { headers: { "Cache-Control": "private, no-store" } });

  const { data: map, error: mapError } = await supabase.rpc("object_crop_bed_map_v1", { p_object_id: objectId });
  if (mapError) return atlasApiError(500, "task_bed_map_failed", "Atlas could not load the bed map.");
  return NextResponse.json({ ok: true, map: map ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
