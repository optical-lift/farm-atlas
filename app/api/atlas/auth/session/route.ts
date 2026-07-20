import { NextResponse } from "next/server";
import { getAtlasIdentity } from "@/lib/atlas-auth";

export async function GET() {
  const identity = await getAtlasIdentity();

  if (!identity) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    authenticated: true,
    user: {
      id: identity.user.id,
      email: identity.user.email ?? null,
      displayName: identity.profile?.display_name ?? identity.user.email ?? "Atlas user",
    },
    memberships: identity.memberships.map((membership) => ({
      farmId: membership.farm_id,
      farmName: membership.farm?.name ?? null,
      farmKey: membership.farm?.stable_key ?? null,
      role: membership.role,
      workerKey: membership.worker_key,
    })),
  });
}
