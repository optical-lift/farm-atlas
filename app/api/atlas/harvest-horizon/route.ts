import { NextResponse } from "next/server";

import { getAtlasSession, membershipForFarm } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 21;
const QUICK_OBSERVATIONS = new Set([
  "vegetative",
  "budding",
  "flowering",
  "fruit_set",
  "first_harvest",
  "peak_harvest",
  "slowing",
  "finished",
]);

const NEAR_HARVEST_STAGES = new Set([
  "budding",
  "flowering",
  "blooming",
  "fruit_set",
  "fruiting",
  "podding",
  "harvesting",
  "first_harvest",
  "peak_harvest",
]);

const CONFIRMED_STAGES = new Set(["harvesting", "first_harvest", "peak_harvest"]);

type ForecastRow = {
  crop_cycle_id: string;
  farm_id: string;
  object_id: string | null;
  object_stable_key: string | null;
  object_label: string | null;
  crop_profile_stable_key: string | null;
  crop_label: string | null;
  variety: string | null;
  expected_harvest_watch_start: string | null;
  expected_harvest_watch_end: string | null;
  cycle_state: string | null;
  forecast_state: string | null;
  bankable_stems: number | null;
  estimated_remaining_stems: number | null;
};

type ObservationRow = {
  crop_cycle_id: string;
  observed_date: string | null;
  stage: string | null;
  condition: string | null;
  confidence: string | null;
  note: string | null;
  created_at: string;
};

type CycleRow = {
  id: string;
  harvest_started_date: string | null;
  last_harvest_date: string | null;
  expected_clear_date: string | null;
};

type AvailabilityRow = {
  crop_cycle_id: string;
  status: string;
  estimated_quantity: number | null;
  unit: string | null;
  observed_date: string | null;
};

type HarvestEventRow = {
  crop_cycle_id: string;
  observed_date: string;
  event_kind: string;
  outcome: string;
  marketable_quantity: number | null;
  unit: string | null;
  more_available: boolean | null;
};

type FarmRow = {
  id: string;
  stable_key: string;
  name: string;
  metadata: Record<string, unknown> | null;
};

type CycleHorizon = {
  cropCycleId: string;
  objectId: string | null;
  objectKey: string | null;
  objectLabel: string;
  cropProfileKey: string | null;
  cropLabel: string;
  variety: string | null;
  windowStart: string;
  windowEnd: string;
  cycleState: string;
  forecastState: string;
  evidenceState: "calculated" | "seen" | "confirmed";
  latestStage: string | null;
  latestCondition: string | null;
  latestObservationDate: string | null;
  latestObservationNote: string | null;
  bankableStems: number | null;
  estimatedRemainingStems: number | null;
  harvestStartedDate: string | null;
  lastHarvestDate: string | null;
  availabilityStatus: string | null;
  latestHarvestQuantity: number | null;
  latestHarvestUnit: string | null;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function isoDate(value: string | null | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalizeLabel(value: string | null | undefined) {
  return (value ?? "crop")
    .toLowerCase()
    .replace(/\bzinnias\b/g, "zinnia")
    .replace(/\bsunflowers\b/g, "sunflower")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function meaningfulVariety(value: string | null | undefined) {
  const normalized = normalizeLabel(value);
  if (!normalized || ["zinnia", "sunflower", "okra", "bean", "beans"].includes(normalized)) return null;
  return value?.trim() || null;
}

function displayCrop(row: ForecastRow) {
  const crop = row.crop_label?.trim() || "Crop";
  const variety = meaningfulVariety(row.variety);
  return variety ? `${crop} · ${variety}` : crop;
}

function waveKey(cycle: CycleHorizon) {
  return [
    cycle.cropProfileKey || normalizeLabel(cycle.cropLabel),
    normalizeLabel(meaningfulVariety(cycle.variety)),
    cycle.windowStart,
    cycle.windowEnd,
  ].join("|");
}

function latestByCycle<T extends { crop_cycle_id: string }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!map.has(row.crop_cycle_id)) map.set(row.crop_cycle_id, row);
  }
  return map;
}

function cycleEvidence(
  row: ForecastRow,
  observation: ObservationRow | undefined,
  cycle: CycleRow | undefined,
  harvestEvent: HarvestEventRow | undefined,
) {
  const stage = (observation?.stage || row.cycle_state || "").toLowerCase();
  if (cycle?.harvest_started_date || harvestEvent || CONFIRMED_STAGES.has(stage)) return "confirmed" as const;
  if (observation) return "seen" as const;
  return "calculated" as const;
}

function strongestEvidence(values: CycleHorizon["evidenceState"][]) {
  if (values.includes("confirmed")) return "confirmed" as const;
  if (values.includes("seen")) return "seen" as const;
  return "calculated" as const;
}

function waveBucket(start: string, end: string, evidence: CycleHorizon["evidenceState"], asOf: string) {
  if (evidence === "confirmed") return "cutting";
  if (start <= asOf && end >= asOf) return "now";
  if (start <= addDays(asOf, 7)) return "week1";
  if (start <= addDays(asOf, 14)) return "week2";
  return "week3";
}

function outlookForDate(cycle: CycleHorizon, dateIso: string) {
  if (cycle.evidenceState === "confirmed" && dateIso <= cycle.windowEnd) return "confirmed" as const;
  if (dateIso < cycle.windowStart) {
    const delta = Math.round((new Date(`${cycle.windowStart}T12:00:00Z`).getTime() - new Date(`${dateIso}T12:00:00Z`).getTime()) / DAY_MS);
    return delta <= 3 ? "possible" as const : "too_early" as const;
  }
  if (dateIso > cycle.windowEnd) return "past_window" as const;
  if (cycle.evidenceState === "seen" && NEAR_HARVEST_STAGES.has((cycle.latestStage || cycle.cycleState).toLowerCase())) return "likely" as const;
  return "possible" as const;
}

function buildWaves(cycles: CycleHorizon[], asOf: string) {
  const groups = new Map<string, CycleHorizon[]>();
  for (const cycle of cycles) {
    const key = waveKey(cycle);
    groups.set(key, [...(groups.get(key) ?? []), cycle]);
  }

  return Array.from(groups.values()).map((members) => {
    const first = members[0];
    const evidenceState = strongestEvidence(members.map((member) => member.evidenceState));
    const bankableStems = members.reduce((sum, member) => sum + Math.max(0, member.bankableStems ?? 0), 0);
    const estimatedRemainingStems = members.reduce((sum, member) => sum + Math.max(0, member.estimatedRemainingStems ?? 0), 0);
    const latestObservation = [...members]
      .filter((member) => member.latestObservationDate || member.latestStage)
      .sort((left, right) => (right.latestObservationDate ?? "").localeCompare(left.latestObservationDate ?? ""))[0] ?? null;
    const objectLabels = Array.from(new Set(members.map((member) => member.objectLabel))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const forecastState = members.some((member) => member.forecastState === "assessment_required")
      ? "assessment_required"
      : members.some((member) => ["stressed", "partial_stand", "sparse_germination", "browsed_alive"].includes(member.cycleState))
        ? "field_confirmation"
        : "baseline";

    return {
      id: waveKey(first),
      farmId: "",
      cropLabel: displayCrop({
        ...({} as ForecastRow),
        crop_label: first.cropLabel,
        variety: first.variety,
      }),
      baseCropLabel: first.cropLabel,
      variety: meaningfulVariety(first.variety),
      windowStart: first.windowStart,
      windowEnd: first.windowEnd,
      bucket: waveBucket(first.windowStart, first.windowEnd, evidenceState, asOf),
      evidenceState,
      forecastState,
      objectLabels,
      bankableStems: bankableStems || null,
      estimatedRemainingStems: estimatedRemainingStems || null,
      latestStage: latestObservation?.latestStage ?? null,
      latestCondition: latestObservation?.latestCondition ?? null,
      latestObservationDate: latestObservation?.latestObservationDate ?? null,
      latestObservationNote: latestObservation?.latestObservationNote ?? null,
      cycles: members,
    };
  }).sort((left, right) => left.windowStart.localeCompare(right.windowStart) || left.cropLabel.localeCompare(right.cropLabel));
}

async function readHorizon(asOf: string) {
  const session = await getAtlasSession();
  if (!session) return { response: privateJson({ ok: false, error: "unauthorized" }, 401) };

  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));
  const supabase = await createAtlasServerClient();
  const horizonEnd = addDays(asOf, HORIZON_DAYS);

  const [{ data: farmRows, error: farmError }, { data: forecastRows, error: forecastError }] = await Promise.all([
    supabase.from("farms").select("id, stable_key, name, metadata").in("id", farmIds),
    supabase
      .from("crop_cycle_yield_forecast")
      .select("crop_cycle_id, farm_id, object_id, object_stable_key, object_label, crop_profile_stable_key, crop_label, variety, expected_harvest_watch_start, expected_harvest_watch_end, cycle_state, forecast_state, bankable_stems, estimated_remaining_stems")
      .in("farm_id", farmIds)
      .eq("lifecycle_status", "active")
      .not("expected_harvest_watch_start", "is", null)
      .lte("expected_harvest_watch_start", horizonEnd)
      .or(`expected_harvest_watch_end.gte.${asOf},expected_harvest_watch_end.is.null`)
      .order("expected_harvest_watch_start", { ascending: true }),
  ]);

  if (farmError || forecastError) {
    return { response: privateJson({ ok: false, error: "Harvest Horizon could not be loaded." }, 500) };
  }

  const forecasts = (forecastRows ?? []) as ForecastRow[];
  const cycleIds = forecasts.map((row) => row.crop_cycle_id);
  let observations: ObservationRow[] = [];
  let cycles: CycleRow[] = [];
  let availability: AvailabilityRow[] = [];
  let harvestEvents: HarvestEventRow[] = [];

  if (cycleIds.length) {
    const [observationResult, cycleResult, availabilityResult, eventResult] = await Promise.all([
      supabase
        .from("crop_observations")
        .select("crop_cycle_id, observed_date, stage, condition, confidence, note, created_at")
        .in("crop_cycle_id", cycleIds)
        .order("observed_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("crop_cycles")
        .select("id, harvest_started_date, last_harvest_date, expected_clear_date")
        .in("id", cycleIds),
      supabase
        .from("crop_harvest_availability")
        .select("crop_cycle_id, status, estimated_quantity, unit, observed_date")
        .in("crop_cycle_id", cycleIds),
      supabase
        .from("crop_harvest_events")
        .select("crop_cycle_id, observed_date, event_kind, outcome, marketable_quantity, unit, more_available")
        .in("crop_cycle_id", cycleIds)
        .order("observed_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);

    if (observationResult.error || cycleResult.error || availabilityResult.error || eventResult.error) {
      return { response: privateJson({ ok: false, error: "Harvest evidence could not be loaded." }, 500) };
    }
    observations = (observationResult.data ?? []) as ObservationRow[];
    cycles = (cycleResult.data ?? []) as CycleRow[];
    availability = (availabilityResult.data ?? []) as AvailabilityRow[];
    harvestEvents = (eventResult.data ?? []) as HarvestEventRow[];
  }

  const observationByCycle = latestByCycle(observations);
  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const availabilityByCycle = new Map(availability.map((row) => [row.crop_cycle_id, row]));
  const eventByCycle = latestByCycle(harvestEvents);

  const cyclesByFarm = new Map<string, CycleHorizon[]>();
  for (const row of forecasts) {
    const windowStart = row.expected_harvest_watch_start;
    const windowEnd = row.expected_harvest_watch_end ?? addDays(windowStart ?? asOf, 21);
    if (!windowStart) continue;
    const observation = observationByCycle.get(row.crop_cycle_id);
    const cycle = cycleById.get(row.crop_cycle_id);
    const event = eventByCycle.get(row.crop_cycle_id);
    const available = availabilityByCycle.get(row.crop_cycle_id);
    const member: CycleHorizon = {
      cropCycleId: row.crop_cycle_id,
      objectId: row.object_id,
      objectKey: row.object_stable_key,
      objectLabel: row.object_label?.trim() || "Growing area",
      cropProfileKey: row.crop_profile_stable_key,
      cropLabel: row.crop_label?.trim() || "Crop",
      variety: meaningfulVariety(row.variety),
      windowStart,
      windowEnd,
      cycleState: row.cycle_state || "growing",
      forecastState: row.forecast_state || "baseline",
      evidenceState: cycleEvidence(row, observation, cycle, event),
      latestStage: observation?.stage ?? null,
      latestCondition: observation?.condition ?? null,
      latestObservationDate: observation?.observed_date ?? null,
      latestObservationNote: observation?.note ?? null,
      bankableStems: row.bankable_stems,
      estimatedRemainingStems: row.estimated_remaining_stems,
      harvestStartedDate: cycle?.harvest_started_date ?? null,
      lastHarvestDate: cycle?.last_harvest_date ?? null,
      availabilityStatus: available?.status ?? null,
      latestHarvestQuantity: event?.marketable_quantity ?? null,
      latestHarvestUnit: event?.unit ?? null,
    };
    cyclesByFarm.set(row.farm_id, [...(cyclesByFarm.get(row.farm_id) ?? []), member]);
  }

  const farms = ((farmRows ?? []) as FarmRow[])
    .map((farm) => {
      const farmCycles = cyclesByFarm.get(farm.id) ?? [];
      const waves = buildWaves(farmCycles, asOf).map((wave) => ({ ...wave, farmId: farm.id }));
      return {
        id: farm.id,
        key: farm.stable_key,
        name: farm.name,
        waves,
        counts: {
          cutting: waves.filter((wave) => wave.bucket === "cutting").length,
          now: waves.filter((wave) => wave.bucket === "now").length,
          week1: waves.filter((wave) => wave.bucket === "week1").length,
          week2: waves.filter((wave) => wave.bucket === "week2").length,
          week3: waves.filter((wave) => wave.bucket === "week3").length,
          needsConfirmation: waves.filter((wave) => wave.forecastState !== "baseline").length,
        },
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return { session, supabase, farms };
}

export async function GET(request: Request) {
  const requestedDate = isoDate(new URL(request.url).searchParams.get("asOf"));
  const asOf = requestedDate ?? localToday();
  const result = await readHorizon(asOf);
  if (result.response) return result.response;
  return privateJson({
    ok: true,
    asOf,
    horizonEnd: addDays(asOf, HORIZON_DAYS),
    horizonDays: HORIZON_DAYS,
    farms: result.farms,
    observationOptions: [
      { key: "vegetative", label: "Still green" },
      { key: "budding", label: "Budding" },
      { key: "flowering", label: "Color / flowers showing" },
      { key: "fruit_set", label: "Fruit or pods setting" },
      { key: "first_harvest", label: "First cut / pick" },
      { key: "peak_harvest", label: "Cutting steadily" },
      { key: "slowing", label: "Slowing" },
      { key: "finished", label: "Finished" },
    ],
  });
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "harvest-horizon-observation-v1") {
    return privateJson({ ok: false, error: "Harvest observation intent is required." }, 400);
  }

  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return privateJson({ ok: false, error: "The harvest observation is invalid." }, 400);
  }

  const farmId = typeof body.farmId === "string" ? body.farmId.trim() : "";
  const cropCycleId = typeof body.cropCycleId === "string" ? body.cropCycleId.trim() : "";
  const objectKey = typeof body.objectKey === "string" ? body.objectKey.trim() : "";
  const observationKey = typeof body.observationKey === "string" ? body.observationKey.trim() : "";
  const eventDate = isoDate(typeof body.eventDate === "string" ? body.eventDate : null) ?? localToday();
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const membership = membershipForFarm(session, farmId);

  if (!membership || !membership.farmKey) return privateJson({ ok: false, error: "This farm is not visible to the signed-in account." }, 403);
  if (!cropCycleId || !objectKey || !QUICK_OBSERVATIONS.has(observationKey)) {
    return privateJson({ ok: false, error: "Choose a crop and a supported field sighting." }, 400);
  }

  const supabase = await createAtlasServerClient();
  const idempotencyKey = `harvest-horizon:${session.userId}:${cropCycleId}:${observationKey}:${eventDate}`;
  const { data, error } = await supabase.rpc("record_crop_observation_v1", {
    p_farm_key: membership.farmKey,
    p_object_key: objectKey,
    p_crop_cycle_id: cropCycleId,
    p_observation_key: observationKey,
    p_event_date: eventDate,
    p_note: note || null,
    p_quantity: null,
    p_unit: null,
    p_state: {
      source_surface: "harvest_horizon",
      recorded_by_membership_id: membership.membershipId,
    },
    p_idempotency_key: idempotencyKey,
  });

  if (error) return privateJson({ ok: false, error: error.message || "The field sighting could not be recorded." }, 400);
  return privateJson({ ok: true, observation: data });
}

export { outlookForDate };
