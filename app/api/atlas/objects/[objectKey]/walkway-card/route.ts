import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ objectKey: string }> };
type RpcError = { code?: string; message?: string };

export async function GET(_request: Request, context: RouteContext) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const { objectKey: rawObjectKey } = await context.params;
  const objectKey = rawObjectKey.trim();
  if (!objectKey || objectKey.length > 160) {
    return NextResponse.json({ ok: false, error: "A valid object key is required." }, { status: 400 });
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("walkway_cards_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_object_key: objectKey,
    p_as_of: new Date().toISOString(),
  });

  if (error) {
    const rpcError = error as RpcError;
    const status = rpcError.code === "42501" ? 403 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: "Atlas Walkway Card read failed.",
        details: rpcError.message,
      },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};

  return NextResponse.json(
    { ok: true, ...result },
    { headers: { "Cache-Control": "private, no-store", "X-Atlas-Read-Path": "walkway-card-v1" } },
  );
}
