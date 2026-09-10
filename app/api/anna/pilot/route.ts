import { NextResponse } from "next/server";

import {
  getAnnaPilotSessionToken,
  hashAnnaPilotToken,
} from "@/lib/anna-worker-day-pilot";
import { createAtlasAdminClient } from "@/lib/supabase/admin";
import { createAtlasServerClient } from "@/lib/supabase/server";
import {
  getAnnaWorkerDelivery,
  getWorkerDelivery,
} from "@/lib/worker-delivery";
import {
  EMPLOYEE_SEAT_SCOPE,
  getCurrentWorkerSessionContext,
} from "@/lib/worker-session";

export const dynamic = "force-dynamic";

type PilotAction =
  | "start"
  | "stop"
  | "done"
  | "reopen"
  | "switch_finish"
  | "switch_stop"
  | "report_unscheduled"
  | "pot_up_contract"
  | "complete_pot_up";

type PilotTransitionResult = {
  ok?: boolean;
  code?: string;
  status?: string;
  activeProjectionId?: string;
  activeTitle?: string;
  [key: string]: unknown;
};

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");

  if (origin && origin !== requestUrl.origin) {
    return noStoreJson({ ok: false, code: "origin_mismatch" }, 403);
  }

  const workerContext = await getCurrentWorkerSessionContext();
  const employeeContext =
    workerContext?.scope === EMPLOYEE_SEAT_SCOPE ? workerContext : null;
  const rawSessionToken = employeeContext
    ? null
    : await getAnnaPilotSessionToken();

  if (!employeeContext && !rawSessionToken) {
    return noStoreJson({ ok: false, code: "unauthorized" }, 401);
  }

  let body: {
    action?: PilotAction;
    projectionId?: string | null;
    effectiveAt?: string | null;
    reportedTitle?: string | null;
    outputs?: unknown;
    idempotencyKey?: string | null;
    note?: string | null;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return noStoreJson({ ok: false, code: "invalid_json" }, 400);
  }

  const allowed = new Set<PilotAction>([
    "start",
    "stop",
    "done",
    "reopen",
    "switch_finish",
    "switch_stop",
    "report_unscheduled",
    "pot_up_contract",
    "complete_pot_up",
  ]);

  if (!body.action || !allowed.has(body.action)) {
    return noStoreJson({ ok: false, code: "unsupported_action" }, 400);
  }

  if (body.effectiveAt && Number.isNaN(Date.parse(body.effectiveAt))) {
    return noStoreJson({ ok: false, code: "invalid_effective_at" }, 400);
  }

  if (body.action === "report_unscheduled") {
    const reportedTitle = body.reportedTitle?.trim() ?? "";
    if (!reportedTitle || reportedTitle.length > 240) {
      return noStoreJson({ ok: false, code: "invalid_reported_title" }, 400);
    }
  } else {
    if (!body.projectionId) {
      return noStoreJson({ ok: false, code: "projection_required" }, 400);
    }

    const delivery = workerContext
      ? await getWorkerDelivery(workerContext)
      : await getAnnaWorkerDelivery();
    const item = delivery.items.find((candidate) => candidate.id === body.projectionId);

    if (!item) {
      return noStoreJson({ ok: false, code: "projection_not_delivered_today" }, 403);
    }

    if (
      item.completed &&
      (body.action === "start" ||
        body.action === "stop" ||
        body.action === "switch_finish" ||
        body.action === "switch_stop")
    ) {
      return noStoreJson({ ok: false, code: "completed_projection_not_attention_eligible" }, 409);
    }

    if (
      item.institutionallyCompleted &&
      (body.action === "done" ||
        body.action === "reopen" ||
        body.action === "complete_pot_up")
    ) {
      return noStoreJson({ ok: false, code: "institutional_completion_is_authoritative" }, 409);
    }

    if (
      (body.action === "pot_up_contract" || body.action === "complete_pot_up") &&
      item.resultContractKey !== "production_pot_up_v1"
    ) {
      return noStoreJson({ ok: false, code: "pot_up_contract_not_available" }, 409);
    }
  }

  if (body.action === "pot_up_contract" || body.action === "complete_pot_up") {
    if (!employeeContext) {
      return noStoreJson({ ok: false, code: "employee_access_required" }, 401);
    }

    const supabase = await createAtlasServerClient();

    if (body.action === "pot_up_contract") {
      const result = await supabase.rpc(
        "worker_production_pot_up_contract_self_api_v1",
        {
          p_delivery_membership_id: employeeContext.deliveryMembershipId,
          p_projection_id: body.projectionId,
        },
      );

      if (result.error) {
        console.error("Pot-up contract read failed:", result.error);
        return noStoreJson({ ok: false, code: "pot_up_contract_failed" }, 500);
      }

      return noStoreJson((result.data ?? { ok: false }) as Record<string, unknown>);
    }

    if (!Array.isArray(body.outputs) || body.outputs.length === 0) {
      return noStoreJson({ ok: false, code: "pot_up_outputs_required" }, 400);
    }

    const idempotencyKey = body.idempotencyKey?.trim() || null;
    if (idempotencyKey && idempotencyKey.length > 160) {
      return noStoreJson({ ok: false, code: "invalid_idempotency_key" }, 400);
    }

    const result = await supabase.rpc(
      "worker_record_production_pot_up_self_api_v1",
      {
        p_delivery_membership_id: employeeContext.deliveryMembershipId,
        p_projection_id: body.projectionId,
        p_outputs: body.outputs,
        p_care_date: null,
        p_note: body.note?.trim() || null,
        p_idempotency_key: idempotencyKey,
      },
    );

    if (result.error) {
      console.error("Structured pot-up completion failed:", result.error);
      return noStoreJson({ ok: false, code: "pot_up_completion_failed" }, 500);
    }

    return noStoreJson((result.data ?? { ok: false }) as Record<string, unknown>);
  }

  let data: unknown;
  let error: { message?: string } | null = null;

  if (employeeContext) {
    const supabase = await createAtlasServerClient();
    const result = await supabase.rpc(
      "worker_delivery_employee_transition_self_api_v1",
      {
        p_delivery_membership_id: employeeContext.deliveryMembershipId,
        p_action: body.action,
        p_projection_id: body.projectionId ?? null,
        p_effective_at: body.effectiveAt ?? null,
        p_reported_title: body.reportedTitle?.trim() || null,
      },
    );
    data = result.data;
    error = result.error;
  } else {
    const supabase = createAtlasAdminClient();
    const result = await supabase.rpc(
      "worker_delivery_pilot_transition_v1",
      {
        p_session_token_hash: hashAnnaPilotToken(rawSessionToken as string),
        p_action: body.action,
        p_projection_id: body.projectionId ?? null,
        p_effective_at: body.effectiveAt ?? null,
        p_reported_title: body.reportedTitle?.trim() || null,
      },
    );
    data = result.data;
    error = result.error;
  }

  if (error) {
    console.error("Worker Day transition failed:", error);
    return noStoreJson({ ok: false, code: "worker_transition_failed" }, 500);
  }

  const result = (data ?? {}) as PilotTransitionResult;
  if (result.ok === true) {
    return noStoreJson(result as Record<string, unknown>);
  }

  if (result.code === "attention_conflict") {
    return noStoreJson(result as Record<string, unknown>, 409);
  }

  if (result.code === "unauthorized" || result.code === "employee_access_required") {
    return noStoreJson(result as Record<string, unknown>, 401);
  }

  return noStoreJson(result as Record<string, unknown>, 400);
}
