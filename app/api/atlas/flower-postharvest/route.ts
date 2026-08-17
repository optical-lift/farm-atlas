import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RANGE_DAYS = 21;

type FarmRow = { id: string; stable_key: string; name: string };
type HarvestBatchRow = { id: string; farm_id: string; harvest_date: string };
type HarvestObservationRow = {
  id: string;
  farm_id: string;
  batch_id: string;
  crop_cycle_id: string;
  observed_date: string;
  bucket_band: string;
  bucket_equivalent_floor: number | string;
};
type PreparationInputRow = { harvest_observation_id: string; preparation_batch_id: string };
type PreparationBatchRow = {
  id: string;
  farm_id: string;
  harvest_batch_id: string;
  prepared_date: string;
  result_kind: string;
};
type ReadyLotRow = {
  id: string;
  farm_id: string;
  preparation_batch_id: string;
  inventory_kind: string;
  quantity: number | string;
  unit: string;
  quantity_exactness: string;
  ready_date: string;
};
type CropCycleRow = { id: string; crop_label: string | null; variety: string | null };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
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

function meaningfulVariety(value: string | null | undefined, cropLabel: string) {
  const variety = value?.trim() || null;
  if (!variety || variety.toLowerCase() === cropLabel.trim().toLowerCase()) return null;
  return variety;
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);

  const asOf = localToday();
  const rangeStart = addDays(asOf, -(RANGE_DAYS - 1));
  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));
  const supabase = await createAtlasServerClient();

  const [farmResult, harvestBatchResult, readyResult] = await Promise.all([
    supabase.from("farms").select("id, stable_key, name").in("id", farmIds),
    supabase
      .from("flower_harvest_batches")
      .select("id, farm_id, harvest_date")
      .in("farm_id", farmIds)
      .gte("harvest_date", rangeStart)
      .lte("harvest_date", asOf)
      .order("harvest_date", { ascending: false }),
    supabase
      .from("flower_ready_inventory_lots")
      .select("id, farm_id, preparation_batch_id, inventory_kind, quantity, unit, quantity_exactness, ready_date")
      .in("farm_id", farmIds)
      .gte("ready_date", rangeStart)
      .lte("ready_date", asOf)
      .order("ready_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (farmResult.error || harvestBatchResult.error || readyResult.error) {
    return privateJson({ ok: false, error: "Flower preparation and Ready truth could not be loaded." }, 500);
  }

  const harvestBatches = (harvestBatchResult.data ?? []) as HarvestBatchRow[];
  const harvestBatchIds = harvestBatches.map((row) => row.id);
  let observations: HarvestObservationRow[] = [];
  let preparationInputs: PreparationInputRow[] = [];
  let preparationBatches: PreparationBatchRow[] = [];

  if (harvestBatchIds.length) {
    const [observationResult, preparationResult] = await Promise.all([
      supabase
        .from("flower_harvest_bucket_observations")
        .select("id, farm_id, batch_id, crop_cycle_id, observed_date, bucket_band, bucket_equivalent_floor")
        .in("batch_id", harvestBatchIds)
        .order("created_at", { ascending: true }),
      supabase
        .from("flower_preparation_batches")
        .select("id, farm_id, harvest_batch_id, prepared_date, result_kind")
        .in("harvest_batch_id", harvestBatchIds)
        .order("prepared_date", { ascending: false }),
    ]);
    if (observationResult.error || preparationResult.error) {
      return privateJson({ ok: false, error: "Flower preparation lineage could not be loaded." }, 500);
    }
    observations = (observationResult.data ?? []) as HarvestObservationRow[];
    preparationBatches = (preparationResult.data ?? []) as PreparationBatchRow[];

    const observationIds = observations.map((row) => row.id);
    if (observationIds.length) {
      const inputResult = await supabase
        .from("flower_preparation_inputs")
        .select("harvest_observation_id, preparation_batch_id")
        .in("harvest_observation_id", observationIds);
      if (inputResult.error) return privateJson({ ok: false, error: "Flower preparation input lineage could not be loaded." }, 500);
      preparationInputs = (inputResult.data ?? []) as PreparationInputRow[];
    }
  }

  const readyLots = (readyResult.data ?? []) as ReadyLotRow[];
  const consumedObservationIds = new Set(preparationInputs.map((row) => row.harvest_observation_id));
  const allCycleIds = Array.from(new Set(observations.map((row) => row.crop_cycle_id)));
  let cycles: CropCycleRow[] = [];
  if (allCycleIds.length) {
    const cycleResult = await supabase.from("crop_cycles").select("id, crop_label, variety").in("id", allCycleIds);
    if (cycleResult.error) return privateJson({ ok: false, error: "Flower crop identity could not be loaded." }, 500);
    cycles = (cycleResult.data ?? []) as CropCycleRow[];
  }
  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const batchById = new Map(harvestBatches.map((batch) => [batch.id, batch]));
  const preparationById = new Map(preparationBatches.map((batch) => [batch.id, batch]));

  const farms = ((farmResult.data ?? []) as FarmRow[]).map((farm) => {
    const farmBatchIds = new Set(harvestBatches.filter((batch) => batch.farm_id === farm.id).map((batch) => batch.id));
    const awaitingByBatch = new Map<string, {
      id: string;
      harvestDate: string;
      bucketEquivalentFloor: number;
      lowerBound: boolean;
      observationCount: number;
      crops: string[];
    }>();

    for (const observation of observations) {
      if (observation.farm_id !== farm.id || consumedObservationIds.has(observation.id)) continue;
      const batch = batchById.get(observation.batch_id);
      if (!batch) continue;
      const crop = cycleById.get(observation.crop_cycle_id);
      const cropLabel = crop?.crop_label?.trim() || "Harvested crop";
      const variety = meaningfulVariety(crop?.variety, cropLabel);
      const label = variety ? `${cropLabel} · ${variety}` : cropLabel;
      const existing = awaitingByBatch.get(observation.batch_id) ?? {
        id: observation.batch_id,
        harvestDate: batch.harvest_date,
        bucketEquivalentFloor: 0,
        lowerBound: false,
        observationCount: 0,
        crops: [],
      };
      existing.bucketEquivalentFloor += Math.max(0, Number(observation.bucket_equivalent_floor) || 0);
      existing.lowerBound = existing.lowerBound || observation.bucket_band === "more_than_one";
      existing.observationCount += 1;
      if (!existing.crops.includes(label)) existing.crops.push(label);
      awaitingByBatch.set(observation.batch_id, existing);
    }

    const ready = readyLots
      .filter((lot) => lot.farm_id === farm.id)
      .map((lot) => {
        const preparation = preparationById.get(lot.preparation_batch_id);
        const sourceBatch = preparation ? batchById.get(preparation.harvest_batch_id) : null;
        return {
          id: lot.id,
          inventoryKind: lot.inventory_kind,
          quantity: Number(lot.quantity),
          unit: lot.unit,
          quantityExactness: lot.quantity_exactness,
          readyDate: lot.ready_date,
          harvestDate: sourceBatch?.harvest_date ?? null,
        };
      });

    const completedNoSaleable = preparationBatches
      .filter((preparation) => preparation.farm_id === farm.id && preparation.result_kind === "no_saleable_output" && farmBatchIds.has(preparation.harvest_batch_id))
      .map((preparation) => ({
        id: preparation.id,
        preparedDate: preparation.prepared_date,
        harvestDate: batchById.get(preparation.harvest_batch_id)?.harvest_date ?? null,
      }));

    return {
      id: farm.id,
      key: farm.stable_key,
      name: farm.name,
      awaitingPreparation: Array.from(awaitingByBatch.values()).sort((left, right) => right.harvestDate.localeCompare(left.harvestDate)),
      ready,
      completedNoSaleable,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  return privateJson({ ok: true, asOf, rangeStart, rangeDays: RANGE_DAYS, farms });
}
