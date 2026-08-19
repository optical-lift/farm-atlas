import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;

type WorkerPresentation = {
  title: string;
  body: string;
  detail: string | null;
  kind: "prerequisite" | "battery_charge" | "equipment" | "waiting";
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(object).filter((row): row is JsonObject => Boolean(row)) : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function workerPresentation(readiness: JsonObject): WorkerPresentation {
  // A prerequisite is the clearest explanation when the job is waiting on
  // another operation. Resource details are secondary until that work clears.
  if (readiness.prerequisitesReady === false) {
    return {
      title: "Not ready yet",
      body: "This job is waiting on another job to be finished first.",
      detail: "Atlas will make it available when that work is done.",
      kind: "prerequisite",
    };
  }

  const consequenceGate = object(readiness.stateConsequenceGate);
  const requirements = rows(consequenceGate?.resourceRequirements);
  const blockingConsequences = rows(consequenceGate?.blockingConsequences);

  const battery = requirements.find((requirement) => text(requirement.resourceKey) === "battery_push_mower_battery_set");
  const batteryState = text(battery?.readinessState || battery?.resourceStatus);
  if (battery && ["needs_charge", "charging"].includes(batteryState)) {
    return {
      title: "Not ready yet",
      body: "The mower batteries need to be charged before this job can start.",
      detail: "Charge them and tap Charged in the reminder. Then this job will be ready.",
      kind: "battery_charge",
    };
  }

  const managementEquipmentBlock = blockingConsequences.some((entry) => {
    const consequence = object(entry.consequence);
    const requirement = object(entry.requirement);
    return text(consequence?.audience) === "farm_operations_management"
      || text(requirement?.resourceStatus) === "needs_repair";
  });

  if (managementEquipmentBlock || readiness.resourcesReady === false) {
    return {
      title: "Not ready yet",
      body: "This job is waiting on equipment.",
      detail: "Nothing you need to do here right now.",
      kind: "equipment",
    };
  }

  return {
    title: "Not ready yet",
    body: "This job can’t be done yet.",
    detail: "Atlas will make it available when the thing it is waiting on is ready.",
    kind: "waiting",
  };
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

export async function GET(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = request.nextUrl.searchParams.get("taskId")?.trim() || "";
  if (!UUID_PATTERN.test(taskId)) {
    return privateJson({ ok: false, error: "A valid task ID is required." }, 400);
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("task_execution_readiness_v1", {
    p_task_id: taskId,
  });

  if (error) {
    console.error("Task execution readiness failed.", error);
    return privateJson({ ok: false, error: "Atlas could not confirm whether this task is ready." }, 500);
  }

  const readiness = object(data);
  if (!readiness) {
    return privateJson({ ok: false, error: "Atlas returned an invalid task readiness result." }, 500);
  }

  const executable = readiness.ready === true;
  return privateJson({
    ok: true,
    executable,
    presentation: executable ? null : workerPresentation(readiness),
  });
}
