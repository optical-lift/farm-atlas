import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "farm-snapshot-shared-member-v1",
    },
  });
}

export async function GET() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("farm_snapshot_for_member_v1", {
    p_farm_id: authorized.access.membership.farmId,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "Active Elm Farm membership required." }, 403);
    }
    console.error("Atlas farm snapshot read failed:", error);
    return privateJson(
      { ok: false, error: "Atlas farm snapshot read failed.", details: rpcError.message },
      500,
    );
  }

  const snapshot = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};

  return privateJson({
    ok: true,
    farmKey: authorized.access.membership.farmKey ?? "elm_farm",
    snapshot,
  });
}
