import { NextResponse } from "next/server";

import { readOwnerWorkerDaySequence } from "@/lib/atlas/worker-day-sequence-server";

export const dynamic = "force-dynamic";

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Read-Path": "worker-day-sequence-v1",
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!validDateIso(date)) return privateJson({ ok: false, error: "date must be YYYY-MM-DD." }, 400);

  try {
    const result = await readOwnerWorkerDaySequence(date as string);
    return privateJson({ ok: true, date, ...result });
  } catch (error) {
    console.error("Atlas worker Day sequence read failed:", error);
    return privateJson({ ok: false, error: "Atlas could not resolve this Day sequence." }, 500);
  }
}
