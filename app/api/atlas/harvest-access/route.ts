import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";

export const dynamic = "force-dynamic";

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET() {
  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager", "farm_hand"] });
  if (!authorized.ok) return authorized.response;

  return privateJson({
    ok: true,
    role: authorized.access.membership.role,
    farmId: authorized.access.membership.farmId,
    membershipId: authorized.access.membership.membershipId,
  });
}
