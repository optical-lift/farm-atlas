import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { atlasFarmDateIso } from "@/lib/atlas/farm-day";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = {
  taskId?: unknown;
  contractId?: unknown;
  values?: unknown;
};

type RpcError = { code?: string; message?: string };

type TaskRow = {
  id?: string | null;
  task_type?: string | null;
  metadata?: Record<string, unknown> | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truthy(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === "1" || value === 1;
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Write-Path": "worker-truth-observation-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return json({ ok: false, error: error.message || "This observation is outside the active worker context." }, 403);
  if (error.code === "P0002") return json({ ok: false, error: error.message || "Observation task was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return json({ ok: false, error: error.message || "The observation was rejected." }, 400);
  if (error.code === "P0001") return json({ ok: false, error: error.message || "Atlas could not reconcile the observation into canonical crop truth." }, 409);
  console.error("Worker truth observation failed.", error);
  return json({ ok: false, error: "Atlas could not record this observation." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return json({ ok: false, error: "Observations require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return json({ ok: false, error: "A JSON observation result is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const contractId = clean(body.contractId);
  const values = body.values && typeof body.values === "object" && !Array.isArray(body.values)
    ? body.values as Record<string, unknown>
    : null;
  const livingPlants = values?.livingPlants;

  if (!UUID_PATTERN.test(taskId)) return json({ ok: false, error: "A valid task id is required." }, 400);
  if (contractId !== `task.${taskId}.crop-observation.stand-count.v1`) {
    return json({ ok: false, error: "The input contract does not match this task." }, 400);
  }
  if (typeof livingPlants !== "number" || !Number.isInteger(livingPlants) || livingPlants < 0) {
    return json({ ok: false, error: "Living plants must be an explicit whole-number count, including 0." }, 400);
  }

  const supabase = await createAtlasServerClient();
  const { data: taskData, error: taskError } = await supabase
    .schema("atlas")
    .from("tasks")
    .select("id, task_type, metadata")
    .eq("id", taskId)
    .eq("farm_id", authorized.access.membership.farmId)
    .limit(1)
    .maybeSingle();

  if (taskError) {
    console.error("Truth observation task lookup failed.", taskError);
    return json({ ok: false, error: "Atlas could not load this observation task." }, 500);
  }
  const task = taskData as TaskRow | null;
  if (!task?.id) return json({ ok: false, error: "Observation task was not found." }, 404);

  const metadata = task.metadata ?? {};
  const instanceId = clean(metadata.truth_acquisition_instance_id);
  const observationKey = clean(metadata.worker_observation_key);
  const supported = task.task_type === "truth_acquisition_observation"
    && truthy(metadata.structured_result_required)
    && clean(metadata.worker_truth_observation_contract) === "record_worker_truth_observation_v1"
    && clean(metadata.result_endpoint) === "record_worker_truth_observation_v1"
    && clean(metadata.worker_observation_adapter) === "crop_observation_v1"
    && observationKey === "stand_count"
    && UUID_PATTERN.test(instanceId);

  if (!supported) {
    return json({ ok: false, error: "This task does not carry the canonical stand-count observation contract." }, 400);
  }

  const serviceDate = atlasFarmDateIso();
  const idempotencyKey = `truth-observation:${taskId}:${serviceDate}`;
  const { data, error } = await supabase.rpc("record_worker_truth_observation_v1", {
    p_instance_id: instanceId,
    p_task_id: taskId,
    p_answer_kind: "observed",
    p_observation_key: observationKey,
    p_quantity: livingPlants,
    p_unit: "plants",
    p_note: null,
    p_idempotency_key: idempotencyKey,
  });

  if (error) return rpcFailure(error as RpcError);
  return json({ ok: true, result: data, serviceDate });
}
