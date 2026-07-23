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

function validStableKey(value: string | null) {
  const key = value?.trim() ?? "";
  return /^[a-zA-Z0-9_-]{1,160}$/.test(key) ? key : null;
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const zoneKey = validStableKey(new URL(request.url).searchParams.get("zoneKey"));
  if (!zoneKey) return privateJson({ ok: false, error: "Choose a valid farm area." }, 400);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("farm_care_zone_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_zone_key: zoneKey,
    p_history_limit: 20,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "Farm access is not active." }, 403);
    }
    if (rpcError.code === "P0002") {
      return privateJson({ ok: false, error: "Atlas could not find this farm area." }, 404);
    }
    console.error("Atlas Farm Care zone read failed:", error);
    return privateJson({ ok: false, error: "Atlas could not load this farm area." }, 500);
  }

  return privateJson({
    ok: true,
    farmKey: authorized.access.membership.farmKey ?? "elm_farm",
    role: authorized.access.membership.role,
    zone: data,
  });
}
