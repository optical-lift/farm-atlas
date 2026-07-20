import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAtlasSession();

  if (!session) {
    return NextResponse.json(
      { ok: false, authenticated: false },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      session,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
