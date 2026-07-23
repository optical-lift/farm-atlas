import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "tending-bed-v1",
    },
  });
}

function stableKey(value: string | null) {
  const key = value?.trim() ?? "";
  return /^[a-zA-Z0-9_-]{1,180}$/.test(key) ? key : null;
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const objectKey = stableKey(new URL(request.url).searchParams.get("objectKey"));
  if (!objectKey) return privateJson({ ok: false, error: "Choose a valid bed." }, 400);

  const workerKey = authorized.access.membership.workerKey?.trim().toLowerCase() || null;
  if (!workerKey) return privateJson({ ok: false, error: "This farm membership has no Atlas worker identity." }, 409);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("tending_bed_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_object_key: objectKey,
    p_worker_key: workerKey,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") return privateJson({ ok: false, error: "Farm access is not active." }, 403);
    if (rpcError.code === "P0002") return privateJson({ ok: false, error: "No harvest track is available for this bed." }, 404);
    console.error("Atlas Tending bed read failed:", error);
    return privateJson({ ok: false, error: "This bed track failed to load." }, 500);
  }

  const prepared = (data ?? {}) as { miniGamesEnabled?: false; bed?: unknown };
  return privateJson({
    ok: true,
    farmKey: authorized.access.membership.farmKey ?? "elm_farm",
    role: authorized.access.membership.role,
    miniGamesEnabled: prepared.miniGamesEnabled ?? false,
    bed: prepared.bed,
  });
}
