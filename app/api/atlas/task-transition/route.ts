import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "This legacy Atlas task action path is unavailable during the user architecture rebuild.",
    },
    {
      status: 410,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
