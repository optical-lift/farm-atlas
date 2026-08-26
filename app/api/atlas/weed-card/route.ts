import { NextResponse } from "next/server";

import { atlasApiError, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function explicitMainCropLabel(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const row = metadata as Record<string, unknown>;
  // Only explicit canonical object metadata is allowed to answer "Bed now".
  // Do not infer a primary crop from overlapping active cycles or the Weed trail.
  for (const key of ["main_crop_label", "active_crop_label"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function componentsFromState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const components = (value as { components?: unknown }).components;
  return Array.isArray(components) ? components : [];
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
  if (!taskId) return atlasApiError(400, "weed_card_task_required", "A task is required.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("weed_card_task_focus_v1", { p_task_id: taskId });
  if (error?.code === "42501") return atlasApiError(403, "weed_card_forbidden", "This Weed Card is not available to the signed-in farm member.");
  if (error?.code === "P0002") return atlasApiError(404, "weed_card_not_found", "The Weed Card was not found.");
  if (error) return atlasApiError(500, "weed_card_read_failed", "Atlas could not load the Weed Card.");
  if (!data || typeof data !== "object" || Array.isArray(data)) return atlasApiError(404, "weed_card_not_found", "The Weed Card was not found.");

  const card = data as Record<string, unknown>;
  const objectId = typeof card.objectId === "string" ? card.objectId : "";
  let bedMap: unknown = null;
  let mainCropLabel: string | null = null;
  let components: unknown[] = [];

  if (objectId) {
    const [mapResult, objectResult, componentResult] = await Promise.all([
      supabase.rpc("object_crop_bed_map_v1", { p_object_id: objectId }),
      supabase.from("growing_objects").select("metadata").eq("id", objectId).maybeSingle(),
      supabase.rpc("bed_components_state_v1", { p_bed_id: objectId }),
    ]);
    if (!mapResult.error) bedMap = mapResult.data;
    if (!objectResult.error) mainCropLabel = explicitMainCropLabel(objectResult.data?.metadata);
    if (!componentResult.error) components = componentsFromState(componentResult.data);
  }

  return privateJson({ ok: true, card: { ...card, mainCropLabel, components, bedMap } });
}