import { NextResponse } from "next/server";

import { classifyAtlasSession } from "@/lib/atlas/auth-core.js";
import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAtlasSession();
  const state = classifyAtlasSession(session);

  if (state.status === "anonymous") {
    return NextResponse.json(
      { ok: false, authenticated: false, accessStatus: "anonymous" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (state.status === "no_membership") {
    return NextResponse.json(
      {
        ok: false,
        authenticated: true,
        accessStatus: "no_membership",
        session,
      },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      accessStatus: "active",
      activeRole: state.activeMembership.role,
      session,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
