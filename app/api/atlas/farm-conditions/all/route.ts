import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { GET as readFarmConditions } from "../route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));
  const conditions: unknown[] = [];

  for (const farmId of farmIds) {
    const childUrl = new URL("/api/atlas/farm-conditions", request.url);
    childUrl.searchParams.set("farmId", farmId);
    const response = await readFarmConditions(new NextRequest(childUrl));
    if (!response.ok) continue;
    const payload = await response.json();
    if (payload?.ok) conditions.push(payload);
  }

  return NextResponse.json({ ok: true, conditions });
}
