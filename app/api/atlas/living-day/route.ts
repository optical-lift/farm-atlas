import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import type { AtlasLivingDay } from "@/lib/atlas/living-day-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function centralDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validDateIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "living-day-v1",
    },
  });
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const farmId = session.activeFarmId ?? session.memberships[0]?.farmId ?? null;
  if (!farmId) return privateJson({ ok: false, error: "An active farm membership is required." }, 403);

  const requestedDate = new URL(request.url).searchParams.get("date");
  if (requestedDate && !validDateIso(requestedDate)) {
    return privateJson({ ok: false, error: "date must be a valid YYYY-MM-DD date." }, 400);
  }
  const dateIso = requestedDate ?? centralDateIso();

  try {
    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("living_day_v1", {
      p_farm_id: farmId,
      p_day: dateIso,
    });
    if (error) throw error;
    return privateJson({ ok: true, livingDay: data as AtlasLivingDay });
  } catch (error) {
    console.error("Atlas Living Day read failed:", error);
    return privateJson({ ok: false, error: "The Living Day could not be loaded." }, 500);
  }
}
