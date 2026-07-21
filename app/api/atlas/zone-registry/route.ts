import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { buildZoneRegistry, type ZoneRegistrySource } from "@/lib/atlas-data/zone-registry";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "zone-registry-membership-v1",
    },
  });
}

export async function GET() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("zone_registry_source_v1", {
    p_farm_id: authorized.access.membership.farmId,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "Active Elm Farm membership required." }, 403);
    }
    console.error("Atlas zone registry read failed:", error);
    return privateJson({ ok: false, error: "Zone registry read failed." }, 500);
  }

  const registry = buildZoneRegistry((data ?? {}) as ZoneRegistrySource);
  return privateJson({ ok: true, ...registry });
}
