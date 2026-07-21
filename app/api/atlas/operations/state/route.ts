import { NextResponse } from "next/server";

import {
  atlasApiError,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { getFarmOperationalState } from "@/lib/atlas-data/operational-state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const farmId = new URL(request.url).searchParams.get("farmId");
  const authorized = await requireAtlasApiAccess({
    farmId,
    allowedRoles: ["owner", "manager"],
  });

  if (!authorized.ok) return authorized.response;

  try {
    const state = await getFarmOperationalState(authorized.access);
    return NextResponse.json(
      { ok: true, state },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return atlasApiError(
      500,
      "operational_state_failed",
      "Atlas could not load the farm state.",
    );
  }
}
