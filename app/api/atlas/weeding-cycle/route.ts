import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

export async function GET() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("weeding_cycle_v1", {
    p_farm_id: authorized.access.membership.farmId,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "Farm access is not active." }, 403);
    }
    console.error("Atlas weeding cycle read failed:", error);
    return privateJson({ ok: false, error: "Atlas weeding cycle read failed." }, 500);
  }

  return privateJson({
    ok: true,
    farmKey: authorized.access.membership.farmKey ?? "elm_farm",
    role: authorized.access.membership.role,
    cycle: data,
  });
}
