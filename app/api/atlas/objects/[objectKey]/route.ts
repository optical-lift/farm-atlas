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
  const { data, error } = await supabase.rpc("object_workbench_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_object_key: objectKey,
    p_history_days: 14,
    p_future_days: 365,
  });

  if (error) {
    const rpcError = error as RpcError;
    const status = rpcError.code === "42501" ? 403 : rpcError.code === "P0002" ? 404 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: status === 404 ? "Atlas could not find this farm object." : "Atlas object workbench read failed.",
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
    { headers: { "Cache-Control": "private, no-store", "X-Atlas-Read-Path": "object-workbench-membership-v1" } },
  );
}
