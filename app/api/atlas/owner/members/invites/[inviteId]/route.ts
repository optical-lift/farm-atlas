import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// No legacy farm invitation RPC or Auth side effect is permitted on this route.
// Only the original, separately authorized Atlas Organization invitation flow
// may admit a new member. This returns a permanent retirement response even if
// an older client still calls the historical URL.
export async function DELETE() {
  return NextResponse.json(
    { ok: false, error: "This legacy farm invitation route has been retired. Use the current Atlas Organization invitation flow." },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}
