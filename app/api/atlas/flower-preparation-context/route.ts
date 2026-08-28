import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TaskRow = {
  id: string;
  farm_id: string;
  due_date: string | null;
  task_type: string;
  metadata: Record<string, unknown> | null;
};

type HarvestBatchRow = {
  id: string;
  harvest_date: string;
};

type HarvestObservationRow = {
  id: string;
  crop_cycle_id: string;
  observed_date: string;
  bucket_band: string;
  bucket_equivalent_floor: number | string;
};

type CropCycleRow = {
  id: string;
  crop_label: string | null;
  variety: string | null;
};

type DirectiveRow = {
  id: string;
  harvest_batch_id: string;
  preparation_occurrence_id: string;
  note: string | null;
};

type DirectiveLineRow = {
  id: string;
  line_number: number;
  crop_profile_id: string | null;
  product_label: string;
  output_kind: "bundle" | "posy" | "bouquet" | "lobby_arrangement";
  requested_quantity: number;
  stems_per_unit: number | null;
  note: string | null;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function meaningfulVariety(value: string | null | undefined, cropLabel: string) {
  const variety = value?.trim() || null;
  if (!variety) return null;
  if (variety.toLowerCase() === cropLabel.trim().toLowerCase()) return null;
  return variety;
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim() || "";
  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid preparation task id is required." }, 400);

  const supabase = await createAtlasServerClient();
  const taskResult = await supabase
    .from("tasks")
    .select("id, farm_id, due_date, task_type, metadata")
    .eq("id", taskId)
    .limit(1)
    .maybeSingle();

  if (taskResult.error) return privateJson({ ok: false, error: "Preparation task could not be loaded." }, 500);
  const task = taskResult.data as TaskRow | null;
  if (!task) return privateJson({ ok: false, error: "Preparation task was not found." }, 404);
  if (task.task_type !== "flower_preparation") return privateJson({ ok: false, error: "Task is not flower preparation." }, 400);

  const visibleFarmIds = new Set(session.memberships.map((membership) => membership.farmId));
  if (!visibleFarmIds.has(task.farm_id)) return privateJson({ ok: false, error: "This preparation task is outside the signed-in farm scope." }, 403);

  const harvestBatchId = text(task.metadata?.flower_harvest_batch_id);
  if (!UUID_PATTERN.test(harvestBatchId)) return privateJson({ ok: false, error: "Preparation task has no valid harvest batch." }, 500);

  const [batchResult, observationResult] = await Promise.all([
    supabase
      .from("flower_harvest_batches")
      .select("id, harvest_date")
      .eq("id", harvestBatchId)
      .eq("farm_id", task.farm_id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("flower_harvest_bucket_observations")
      .select("id, crop_cycle_id, observed_date, bucket_band, bucket_equivalent_floor")
      .eq("batch_id", harvestBatchId)
      .eq("farm_id", task.farm_id)
      .order("created_at", { ascending: true }),
  ]);

  if (batchResult.error || observationResult.error) {
    return privateJson({ ok: false, error: "Harvested preparation input could not be loaded." }, 500);
  }
  const batch = batchResult.data as HarvestBatchRow | null;
  if (!batch) return privateJson({ ok: false, error: "Preparation harvest batch was not found." }, 404);

  const observations = (observationResult.data ?? []) as HarvestObservationRow[];
  const observationIds = observations.map((row) => row.id);
  let consumedIds = new Set<string>();

  if (observationIds.length) {
    const inputResult = await supabase
      .from("flower_preparation_inputs")
      .select("harvest_observation_id")
      .in("harvest_observation_id", observationIds);
    if (inputResult.error) return privateJson({ ok: false, error: "Preparation lineage could not be loaded." }, 500);
    consumedIds = new Set((inputResult.data ?? []).map((row) => String(row.harvest_observation_id)));
  }

  const unprepared = observations.filter((row) => !consumedIds.has(row.id));
  const cycleIds = Array.from(new Set(unprepared.map((row) => row.crop_cycle_id)));
  let cycles: CropCycleRow[] = [];
  if (cycleIds.length) {
    const cycleResult = await supabase
      .from("crop_cycles")
      .select("id, crop_label, variety")
      .in("id", cycleIds);
    if (cycleResult.error) return privateJson({ ok: false, error: "Preparation crop identity could not be loaded." }, 500);
    cycles = (cycleResult.data ?? []) as CropCycleRow[];
  }

  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  const inputs = unprepared.map((row) => {
    const crop = cycleById.get(row.crop_cycle_id);
    const cropLabel = crop?.crop_label?.trim() || "Harvested crop";
    return {
      id: row.id,
      cropLabel,
      variety: meaningfulVariety(crop?.variety, cropLabel),
      observedDate: row.observed_date,
      bucketEquivalentFloor: Number(row.bucket_equivalent_floor),
      lowerBound: row.bucket_band === "more_than_one",
    };
  });

  const directiveId = text(task.metadata?.flower_preparation_directive_id);
  let directive: Record<string, unknown> | null = null;
  if (UUID_PATTERN.test(directiveId)) {
    const [directiveResult, lineResult] = await Promise.all([
      supabase
        .from("flower_preparation_directives")
        .select("id, harvest_batch_id, preparation_occurrence_id, note")
        .eq("id", directiveId)
        .eq("farm_id", task.farm_id)
        .eq("harvest_batch_id", harvestBatchId)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("flower_preparation_directive_lines")
        .select("id, line_number, crop_profile_id, product_label, output_kind, requested_quantity, stems_per_unit, note")
        .eq("directive_id", directiveId)
        .eq("farm_id", task.farm_id)
        .order("line_number", { ascending: true }),
    ]);

    if (directiveResult.error || lineResult.error) {
      return privateJson({ ok: false, error: "Owner preparation directions could not be loaded." }, 500);
    }

    const directiveRow = directiveResult.data as DirectiveRow | null;
    const lines = (lineResult.data ?? []) as DirectiveLineRow[];
    const plannedOccurrenceId = text(task.metadata?.planned_occurrence_id);
    if (!directiveRow || !lines.length) {
      return privateJson({ ok: false, error: "Owner preparation directions are missing." }, 500);
    }
    if (UUID_PATTERN.test(plannedOccurrenceId) && directiveRow.preparation_occurrence_id !== plannedOccurrenceId) {
      return privateJson({ ok: false, error: "Owner preparation directions do not belong to this task occurrence." }, 409);
    }

    directive = {
      id: directiveRow.id,
      note: directiveRow.note,
      lines: lines.map((line) => ({
        id: line.id,
        lineNumber: line.line_number,
        cropProfileId: line.crop_profile_id,
        productLabel: line.product_label,
        outputKind: line.output_kind,
        requestedQuantity: line.requested_quantity,
        stemsPerUnit: line.stems_per_unit,
        note: line.note,
      })),
    };
  }

  return privateJson({
    ok: true,
    task: {
      id: task.id,
      dueDate: task.due_date,
      harvestDate: batch.harvest_date,
      inputs,
      directive,
    },
  });
}
