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
  if (!data) return atlasApiError(404, "weed_card_not_found", "The Weed Card was not found.");

  return privateJson({ ok: true, card: data });
}
