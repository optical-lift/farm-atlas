import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type DirectHarvestSourceRow = {
  key: string;
  label: string;
  detail: string;
  cropProfileId: string | null;
  origin: "elm" | "external";
};

export type DirectHarvestContext = {
  ok: boolean;
  error?: string;
  harvestBatchId?: string;
  harvestDate?: string | null;
  harvestSummaryDetail: string;
  sourceRows: DirectHarvestSourceRow[];
};

type ObservationRow = {
  id: string;
  crop_cycle_id: string | null;
  bucket_halves: number | null;
  bucket_equivalent_floor: number | null;
  more_available: boolean | null;
};

type CropCycleRow = {
  id: string;
  crop_profile_id: string | null;
  crop_label: string | null;
  variety: string | null;
};

type IntakeRow = {
  id: string;
  source_kind: string;
  source_label: string;
};

type IntakeLineRow = {
  id: string;
  intake_id: string;
  line_number: number;
  flower_label: string;
  color_label: string | null;
  count_unit: string;
  quantity: number;
};

function formatBuckets(bucketHalves: number) {
  const buckets = bucketHalves / 2;
  if (Number.isInteger(buckets)) return `${buckets}`;
  return `${Math.floor(buckets)}½`.replace("0½", "½");
}

function pluralUnit(unit: string, quantity: number) {
  if (quantity === 1) return unit;
  if (unit === "bucket") return "buckets";
  if (unit === "bundle") return "bundles";
  return "stems";
}

function displayCrop(cycle: CropCycleRow) {
  const crop = cycle.crop_label?.trim() || "Flower";
  const variety = cycle.variety?.trim();
  if (!variety) return crop;
  return variety.toLowerCase().includes(crop.toLowerCase()) ? variety : `${variety} ${crop}`;
}

export async function loadDirectHarvestContext(task: AtlasTaskCard): Promise<DirectHarvestContext> {
  const batchId = typeof task.metadata?.flower_harvest_batch_id === "string"
    ? task.metadata.flower_harvest_batch_id.trim()
    : "";

  if (!batchId) {
    return { ok: false, error: "Direct Harvest is missing its flower custody batch.", harvestSummaryDetail: "Harvest custody unavailable", sourceRows: [] };
  }

  const supabase = await createAtlasServerClient();
  const { data: batch, error: batchError } = await supabase
    .schema("atlas")
    .from("flower_harvest_batches")
    .select("id,harvest_date")
    .eq("id", batchId)
    .maybeSingle();

  if (batchError || !batch?.id) {
    console.error("Direct Harvest batch lookup failed.", batchError);
    return { ok: false, error: "Harvest custody could not be loaded.", harvestSummaryDetail: "Harvest custody unavailable", sourceRows: [] };
  }

  const { data: observationData, error: observationError } = await supabase
    .schema("atlas")
    .from("flower_harvest_bucket_observations")
    .select("id,crop_cycle_id,bucket_halves,bucket_equivalent_floor,more_available")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });

  if (observationError) console.error("Direct Harvest field custody lookup failed.", observationError);
  const observations = (observationData ?? []) as ObservationRow[];
  const cycleIds = Array.from(new Set(observations.map((row) => row.crop_cycle_id).filter((value): value is string => Boolean(value))));

  let cycles: CropCycleRow[] = [];
  if (cycleIds.length) {
    const { data: cycleData, error: cycleError } = await supabase
      .schema("atlas")
      .from("crop_cycles")
      .select("id,crop_profile_id,crop_label,variety")
      .in("id", cycleIds);
    if (cycleError) console.error("Direct Harvest crop identity lookup failed.", cycleError);
    cycles = (cycleData ?? []) as CropCycleRow[];
  }
  const cycleById = new Map(cycles.map((row) => [row.id, row]));

  const fieldGroups = new Map<string, { label: string; cropProfileId: string | null; halves: number; moreAvailable: boolean }>();
  let totalFieldHalves = 0;
  for (const observation of observations) {
    const cycle = observation.crop_cycle_id ? cycleById.get(observation.crop_cycle_id) : null;
    const label = cycle ? displayCrop(cycle) : "Flower";
    const cropProfileId = cycle?.crop_profile_id ?? null;
    const key = cropProfileId || `${observation.crop_cycle_id || observation.id}:${label.toLowerCase()}`;
    const halves = Number.isInteger(observation.bucket_halves) ? observation.bucket_halves ?? 0 : Math.round(Number(observation.bucket_equivalent_floor ?? 0) * 2);
    totalFieldHalves += Math.max(0, halves);
    const existing = fieldGroups.get(key);
    fieldGroups.set(key, {
      label,
      cropProfileId,
      halves: (existing?.halves ?? 0) + Math.max(0, halves),
      moreAvailable: Boolean(existing?.moreAvailable || observation.more_available),
    });
  }

  const { data: intakeData, error: intakeError } = await supabase
    .schema("atlas")
    .from("flower_external_intakes")
    .select("id,source_kind,source_label")
    .eq("harvest_batch_id", batchId)
    .order("created_at", { ascending: true });
  if (intakeError) console.error("Direct Harvest external source lookup failed.", intakeError);
  const intakes = (intakeData ?? []) as IntakeRow[];
  const intakeById = new Map(intakes.map((row) => [row.id, row]));
  const intakeIds = intakes.map((row) => row.id);

  let externalLines: IntakeLineRow[] = [];
  if (intakeIds.length) {
    const { data: lineData, error: lineError } = await supabase
      .schema("atlas")
      .from("flower_external_intake_lines")
      .select("id,intake_id,line_number,flower_label,color_label,count_unit,quantity")
      .in("intake_id", intakeIds)
      .order("created_at", { ascending: true })
      .order("line_number", { ascending: true });
    if (lineError) console.error("Direct Harvest external flower lookup failed.", lineError);
    externalLines = (lineData ?? []) as IntakeLineRow[];
  }

  const sourceRows: DirectHarvestSourceRow[] = [];
  for (const [key, group] of fieldGroups) {
    const amount = group.halves > 0 ? `${formatBuckets(group.halves)} bucket${group.halves === 2 ? "" : "s"}` : "harvested amount recorded";
    sourceRows.push({
      key: `elm:${key}`,
      label: group.label,
      detail: `${amount} · Elm harvest${group.moreAvailable ? " · more available" : ""}`,
      cropProfileId: group.cropProfileId,
      origin: "elm",
    });
  }

  for (const line of externalLines) {
    const intake = intakeById.get(line.intake_id);
    const label = `${line.color_label ? `${line.color_label.trim()} ` : ""}${line.flower_label.trim()}`.trim();
    sourceRows.push({
      key: `external:${line.id}`,
      label,
      detail: `${line.quantity} ${pluralUnit(line.count_unit, line.quantity)} · ${intake?.source_label || "External source"} · ${intake?.source_kind || "external"}`,
      cropProfileId: null,
      origin: "external",
    });
  }

  const summaryParts: string[] = [];
  if (totalFieldHalves > 0) summaryParts.push(`${formatBuckets(totalFieldHalves)} bucket${totalFieldHalves === 2 ? "" : "s"}`);
  if (externalLines.length) summaryParts.push(`${externalLines.length} external row${externalLines.length === 1 ? "" : "s"}`);

  return {
    ok: !observationError && !intakeError,
    error: observationError || intakeError ? "Some harvest custody could not be loaded." : undefined,
    harvestBatchId: batch.id,
    harvestDate: batch.harvest_date ?? task.due_date ?? null,
    harvestSummaryDetail: summaryParts.join(" + ") || "Harvest custody recorded",
    sourceRows,
  };
}
