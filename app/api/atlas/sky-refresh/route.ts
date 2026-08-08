import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession, membershipForFarm } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CALCULATION_VERSION = "atlas_sky_ephemeris_v1";
const REFRESH_DAYS = 92;
const MIN_FORWARD_COVERAGE_DAYS = 75;

function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDateIso(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

type LedgerStatus = {
  coverageFrom?: string | null;
  coverageThrough?: string | null;
  calculationVersion?: string | null;
  sampleCount?: number;
  windowCount?: number;
};

type CalculatorPayload = {
  contractVersion: string;
  range: {
    startDate: string;
    endDate: string;
    days: number;
    timeZone: string;
    rangeStart: string;
    rangeEnd: string;
  };
  source: {
    provider: string;
    version: string;
    calculationVersion: string;
  };
  samples: unknown[];
  windows: unknown[];
};

export async function POST(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { farmId?: string };
  const requestedFarmId = body.farmId ?? request.nextUrl.searchParams.get("farmId") ?? null;
  const farmId = requestedFarmId && membershipForFarm(session, requestedFarmId)
    ? requestedFarmId
    : session.activeFarmId;
  if (!farmId) return NextResponse.json({ error: "farm membership required" }, { status: 403 });

  const membership = membershipForFarm(session, farmId);
  if (!membership || !["owner", "manager"].includes(membership.role)) {
    return NextResponse.json({ error: "farm management membership required" }, { status: 403 });
  }

  const supabase = await createAtlasServerClient();
  const [{ data: farm, error: farmError }, { data: statusData, error: statusError }] = await Promise.all([
    supabase.from("farms").select("id, metadata").eq("id", farmId).single(),
    supabase.rpc("sky_ledger_status_v1", { p_farm_id: farmId }),
  ]);

  if (farmError || !farm) return NextResponse.json({ error: "farm unavailable" }, { status: 404 });
  if (statusError) return NextResponse.json({ error: "sky ledger status unavailable" }, { status: 500 });

  const timezone = typeof farm.metadata?.timezone === "string" && farm.metadata.timezone
    ? farm.metadata.timezone
    : "America/Chicago";
  const today = localDateIso(timezone);
  const requiredThrough = addDaysIso(today, MIN_FORWARD_COVERAGE_DAYS);
  const status = (statusData ?? {}) as LedgerStatus;
  const covered = Boolean(
    status.coverageFrom
      && status.coverageFrom <= today
      && status.coverageThrough
      && status.coverageThrough >= requiredThrough
      && status.calculationVersion === CALCULATION_VERSION,
  );

  if (covered) {
    return NextResponse.json({ refreshed: false, reason: "coverage_current", status });
  }

  const startDate = addDaysIso(today, -1);
  const { data: calculatorData, error: calculatorError } = await supabase.functions.invoke(
    "atlas-sky-window-calculator",
    { body: { timezone, start_date: startDate, days: REFRESH_DAYS } },
  );

  if (calculatorError || !calculatorData) {
    return NextResponse.json(
      { error: "sky calculation failed", detail: calculatorError?.message ?? null },
      { status: 502 },
    );
  }

  const calculated = calculatorData as CalculatorPayload;
  if (
    calculated.source?.calculationVersion !== CALCULATION_VERSION
    || !Array.isArray(calculated.samples)
    || !Array.isArray(calculated.windows)
    || !calculated.range?.rangeStart
    || !calculated.range?.rangeEnd
  ) {
    return NextResponse.json({ error: "sky calculator contract mismatch" }, { status: 502 });
  }

  const { data: ingestData, error: ingestError } = await supabase.rpc("ingest_sky_ledger_v1", {
    p_farm_id: farmId,
    p_range_start: calculated.range.rangeStart,
    p_range_end: calculated.range.rangeEnd,
    p_calculation_version: calculated.source.calculationVersion,
    p_samples: calculated.samples,
    p_windows: calculated.windows,
  });

  if (ingestError) {
    return NextResponse.json(
      { error: "sky ledger ingest failed", detail: ingestError.message },
      { status: 500 },
    );
  }

  const { data: refreshedStatus } = await supabase.rpc("sky_ledger_status_v1", { p_farm_id: farmId });
  return NextResponse.json({
    refreshed: true,
    calculation: {
      provider: calculated.source.provider,
      version: calculated.source.version,
      calculationVersion: calculated.source.calculationVersion,
      sampleCount: calculated.samples.length,
      windowCount: calculated.windows.length,
      rangeStart: calculated.range.rangeStart,
      rangeEnd: calculated.range.rangeEnd,
    },
    ingest: ingestData,
    status: refreshedStatus,
  });
}
