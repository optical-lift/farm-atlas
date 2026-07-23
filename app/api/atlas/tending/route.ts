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
      "X-Atlas-Read-Path": "tending-board-v1",
    },
  });
}

export async function GET() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const workerKey = authorized.access.membership.workerKey?.trim().toLowerCase() || null;
  if (!workerKey) return privateJson({ ok: false, error: "This farm membership has no Atlas worker identity." }, 409);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("tending_board_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_worker_key: workerKey,
    p_due_through: null,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") return privateJson({ ok: false, error: "Farm access is not active." }, 403);
    if (rpcError.code === "P0002") return privateJson({ ok: false, error: "Atlas could not resolve this farm membership." }, 404);
    console.error("Atlas Tending board read failed:", error);
    return privateJson({ ok: false, error: "Tending failed to load." }, 500);
  }

  return privateJson({
    ok: true,
    farmKey: authorized.access.membership.farmKey ?? "elm_farm",
    role: authorized.access.membership.role,
    tending: data,
  });
}
