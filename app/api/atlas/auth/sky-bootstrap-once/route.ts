import { NextResponse } from "next/server";

import { createAtlasAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ELM_FARM_ID = "6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f";
const TIMEZONE = "America/Chicago";
const TARGET_DAYS = 90;

function dateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function GET() {
  const admin = createAtlasAdminClient();
  const today = dateInTimezone(new Date(), TIMEZONE);
  const { data: status, error: statusError } = await admin.rpc("sky_ledger_status_v1", {
    p_farm_id: ELM_FARM_ID,
  });

  if (statusError) {
    return NextResponse.json({ ok: false, error: statusError.message }, { status: 500 });
  }

  const latest = typeof status?.coverageThrough === "string" ? status.coverageThrough : null;
  if (latest) {
    const coverageDays = Math.floor(
      (new Date(`${latest}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000,
    );
    if (coverageDays >= 75) {
      return NextResponse.json({ ok: true, skipped: true, reason: "coverage already sufficient", coverageThrough: latest });
    }
  }

  const { data: calculated, error: calculateError } = await admin.functions.invoke(
    "atlas-sky-window-calculator",
    { body: { timezone: TIMEZONE, start_date: today, days: TARGET_DAYS } },
  );

  if (calculateError || !calculated?.range || !Array.isArray(calculated?.samples) || !Array.isArray(calculated?.windows)) {
    return NextResponse.json(
      { ok: false, error: calculateError?.message ?? "Sky calculator returned an invalid packet." },
      { status: 502 },
    );
  }

  const { data: ingested, error: ingestError } = await admin.rpc("ingest_sky_ledger_v1", {
    p_farm_id: ELM_FARM_ID,
    p_range_start: calculated.range.rangeStart,
    p_range_end: calculated.range.rangeEnd,
    p_calculation_version: calculated.source.calculationVersion,
    p_samples: calculated.samples,
    p_windows: calculated.windows,
  });

  if (ingestError) {
    return NextResponse.json({ ok: false, error: ingestError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    farmId: ELM_FARM_ID,
    startDate: today,
    days: TARGET_DAYS,
    source: calculated.source,
    ingested,
  });
}
