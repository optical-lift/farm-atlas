import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RECENT_HARVEST_DAYS = 14;

type Json = Record<string, unknown>;
type CropCycleRow = {
  id: string;
  farm_id: string;
  object_id: string | null;
  crop_profile_id: string | null;
  crop_label: string | null;
  variety: string | null;
  cycle_state: string | null;
  lifecycle_status: string | null;
};
type CropProfileRow = { id: string; crop_label: string | null; variety: string | null; metadata: Json | null };
type ObjectRow = { id: string; stable_key: string | null; label: string | null };
type HarvestBatchRow = { id: string; harvest_date: string; recorded_by_membership_id: string; note: string | null; metadata: Json | null; created_at: string };
type HarvestObservationRow = { id: string; batch_id: string; crop_cycle_id: string; recorded_by_membership_id: string; observed_date: string; bucket_equivalent_floor: number | string; bucket_halves: number | null; more_availability: string | null; metadata: Json | null; created_at: string };
type PrepBatchRow = { id: string; harvest_batch_id: string; prepared_date: string; recorded_by_membership_id: string; note: string | null; metadata: Json | null; created_at: string };
type ReadyLotRow = { id: string; preparation_batch_id: string; inventory_kind: string; quantity: number | string; unit: string; product_label: string | null; metadata: Json | null };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function centralDateIso(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metadataText(metadata: Json | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function stemsPerUnit(metadata: Json | null | undefined) {
  const parsed = number(metadata?.stemsPerUnit);
  return parsed > 0 ? parsed : null;
}

function cropName(cycle: CropCycleRow | undefined, profile: CropProfileRow | undefined) {
  return cycle?.crop_label?.trim() || profile?.crop_label?.trim() || "Crop";
}

function cropVariety(cycle: CropCycleRow | undefined, profile: CropProfileRow | undefined) {
  return cycle?.variety?.trim() || profile?.variety?.trim() || null;
}

function halfBucketText(halves: number | null, fallback: number) {
  const normalizedHalves = Number.isInteger(halves) && Number(halves) > 0 ? Number(halves) : Math.round(fallback * 2);
  const whole = Math.floor(normalizedHalves / 2);
  const half = normalizedHalves % 2;
  if (!whole && half) return "½ bucket";
  if (whole === 1 && !half) return "1 bucket";
  return `${whole}${half ? "½" : ""} buckets`;
}

function outputText(lot: ReadyLotRow) {
  const quantity = number(lot.quantity);
  const amount = Number.isInteger(quantity) ? quantity.toFixed(0) : quantity.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const label = lot.product_label?.trim() || lot.inventory_kind.replace(/_/g, " ");
  if (lot.unit === "bunch") {
    const stems = stemsPerUnit(lot.metadata);
    return `${amount} × ${label} bunch${quantity === 1 ? "" : "es"}${stems ? ` · ${stems} stems each` : ""}`;
  }
  if (lot.unit === "posy") return `${amount} × ${label} ${quantity === 1 ? "posy" : "posies"}`;
  if (lot.unit === "bucket_equivalent") return `${amount} × ${label} bucket${quantity === 1 ? "" : "s"}`;
  return `${amount} × ${label} ${lot.unit.replace(/_/g, " ")}${quantity === 1 ? "" : "s"}`;
}

export async function GET() {
  const authorized = await requireAtlasApiAccess({ allowedRoles: ["farm_hand"] });
  if (!authorized.ok) return authorized.response;

  const { membership } = authorized.access;
  const farmId = membership.farmId;
  const membershipId = membership.membershipId;
  const today = centralDateIso();
  const recentStart = addDays(today, -(RECENT_HARVEST_DAYS - 1));
  const supabase = await createAtlasServerClient();

  const [farmResult, cyclesResult, objectsResult, batchesResult, observationsResult, prepResult] = await Promise.all([
    supabase.from("farms").select("id, name").eq("id", farmId).maybeSingle(),
    supabase.from("crop_cycles").select("id, farm_id, object_id, crop_profile_id, crop_label, variety, cycle_state, lifecycle_status").eq("farm_id", farmId).eq("lifecycle_status", "active"),
    supabase.from("growing_objects").select("id, stable_key, label").eq("farm_id", farmId),
    supabase.from("flower_harvest_batches").select("id, harvest_date, recorded_by_membership_id, note, metadata, created_at").eq("farm_id", farmId).gte("harvest_date", recentStart).order("created_at", { ascending: false }).limit(20),
    supabase.from("flower_harvest_bucket_observations").select("id, batch_id, crop_cycle_id, recorded_by_membership_id, observed_date, bucket_equivalent_floor, bucket_halves, more_availability, metadata, created_at").eq("farm_id", farmId).gte("observed_date", recentStart).order("created_at", { ascending: false }),
    supabase.from("flower_preparation_batches").select("id, harvest_batch_id, prepared_date, recorded_by_membership_id, note, metadata, created_at").eq("farm_id", farmId).eq("recorded_by_membership_id", membershipId).eq("prepared_date", today).order("created_at", { ascending: false }),
  ]);

  if (farmResult.error || cyclesResult.error || objectsResult.error || batchesResult.error || observationsResult.error || prepResult.error || !farmResult.data) {
    return privateJson({ ok: false, error: "Flower logging context could not be loaded." }, 500);
  }

  const cycles = (cyclesResult.data ?? []) as CropCycleRow[];
  const profileIds = Array.from(new Set(cycles.flatMap((cycle) => cycle.crop_profile_id ? [cycle.crop_profile_id] : [])));
  const profilesResult = profileIds.length
    ? await supabase.from("crop_profiles").select("id, crop_label, variety, metadata").in("id", profileIds)
    : { data: [] as CropProfileRow[], error: null };
  if (profilesResult.error) return privateJson({ ok: false, error: "Flower crop context could not be loaded." }, 500);

  const prepBatches = (prepResult.data ?? []) as PrepBatchRow[];
  const prepIds = prepBatches.map((batch) => batch.id);
  const readyResult = prepIds.length
    ? await supabase.from("flower_ready_inventory_lots").select("id, preparation_batch_id, inventory_kind, quantity, unit, product_label, metadata").in("preparation_batch_id", prepIds).order("created_at", { ascending: true })
    : { data: [] as ReadyLotRow[], error: null };
  if (readyResult.error) return privateJson({ ok: false, error: "Today’s flower preparation could not be loaded." }, 500);

  const profiles = (profilesResult.data ?? []) as CropProfileRow[];
  const objects = (objectsResult.data ?? []) as ObjectRow[];
  const batches = (batchesResult.data ?? []) as HarvestBatchRow[];
  const observations = (observationsResult.data ?? []) as HarvestObservationRow[];
  const readyLots = (readyResult.data ?? []) as ReadyLotRow[];

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const observationsByBatch = new Map<string, HarvestObservationRow[]>();
  for (const observation of observations) observationsByBatch.set(observation.batch_id, [...(observationsByBatch.get(observation.batch_id) ?? []), observation]);
  const readyByPrep = new Map<string, ReadyLotRow[]>();
  for (const lot of readyLots) readyByPrep.set(lot.preparation_batch_id, [...(readyByPrep.get(lot.preparation_batch_id) ?? []), lot]);

  const cropOptions = cycles.map((cycle) => {
    const profile = cycle.crop_profile_id ? profileById.get(cycle.crop_profile_id) : undefined;
    const object = cycle.object_id ? objectById.get(cycle.object_id) : undefined;
    const useTags = Array.isArray(profile?.metadata?.use_tags) ? profile.metadata.use_tags : [];
    return {
      cropCycleId: cycle.id,
      cropLabel: cropName(cycle, profile),
      variety: cropVariety(cycle, profile),
      objectLabel: object?.label?.trim() || "Growing area",
      objectKey: object?.stable_key || null,
      useTags,
      cycleState: cycle.cycle_state,
    };
  }).filter((option) => option.useTags.includes("cut_flower") && !option.objectKey?.startsWith("grow_room_") && !["failed", "cleared", "finished", "finished_harvest"].includes((option.cycleState || "").toLowerCase()))
    .sort((left, right) => left.objectLabel.localeCompare(right.objectLabel, undefined, { numeric: true }) || left.cropLabel.localeCompare(right.cropLabel));

  const harvestBatches = batches.map((batch) => {
    const rows = observationsByBatch.get(batch.id) ?? [];
    const names = rows.map((row) => {
      const cycle = cycleById.get(row.crop_cycle_id);
      const profile = cycle?.crop_profile_id ? profileById.get(cycle.crop_profile_id) : undefined;
      const name = cropName(cycle, profile);
      return cropVariety(cycle, profile) ? `${name} · ${cropVariety(cycle, profile)}` : name;
    });
    const distinctNames = names.filter((name, index) => names.indexOf(name) === index);
    return {
      id: batch.id,
      harvestDate: batch.harvest_date,
      createdAt: batch.created_at,
      summary: distinctNames.join(" + ") || "Harvest batch",
    };
  });

  const todayHarvestByBatch = new Map<string, HarvestObservationRow[]>();
  for (const observation of observations.filter((row) => row.recorded_by_membership_id === membershipId && row.observed_date === today)) {
    todayHarvestByBatch.set(observation.batch_id, [...(todayHarvestByBatch.get(observation.batch_id) ?? []), observation]);
  }

  const loggedToday = [
    ...Array.from(todayHarvestByBatch.entries()).map(([batchId, rows]) => {
      const batch = batches.find((candidate) => candidate.id === batchId);
      const detail = rows.map((row) => {
        const cycle = cycleById.get(row.crop_cycle_id);
        const profile = cycle?.crop_profile_id ? profileById.get(cycle.crop_profile_id) : undefined;
        const object = cycle?.object_id ? objectById.get(cycle.object_id) : undefined;
        return `${halfBucketText(row.bucket_halves, number(row.bucket_equivalent_floor))} ${cropName(cycle, profile)}${object?.label ? ` · ${object.label}` : ""}`;
      }).join("; ");
      return {
        id: `harvest:${batchId}`,
        kind: "harvest",
        at: batch?.created_at || rows[0]?.created_at || `${today}T12:00:00Z`,
        label: "Harvest logged",
        detail,
        source: metadataText(batch?.metadata, "entrySurface") === "worker_day" ? "Quick log" : "Task",
      };
    }),
    ...prepBatches.map((batch) => ({
      id: `prep:${batch.id}`,
      kind: "preparation",
      at: batch.created_at,
      label: "Prep batch logged",
      detail: (readyByPrep.get(batch.id) ?? []).map(outputText).join("; ") || "Finished flower batch",
      source: metadataText(batch.metadata, "entrySurface") === "worker_day" ? "Quick log" : "Task",
    })),
  ].sort((left, right) => right.at.localeCompare(left.at));

  return privateJson({
    ok: true,
    asOf: today,
    farm: { id: farmResult.data.id, name: farmResult.data.name },
    cropOptions,
    harvestBatches,
    loggedToday,
  });
}
