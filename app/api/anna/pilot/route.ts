import { NextResponse } from "next/server";

import {
  getAnnaPilotSessionToken,
  hashAnnaPilotToken,
} from "@/lib/anna-worker-day-pilot";
import { createAtlasAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type PilotAction =
  | "start"
  | "stop"
  | "done"
  | "reopen"
  | "switch_finish"
  | "switch_stop"
  | "report_unscheduled";

type PilotTransitionResult = {
  ok?: boolean;
  code?: string;
  status?: string;
  activeProjectionId?: string;
  activeTitle?: string;
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

  const rawSessionToken = await getAnnaPilotSessionToken();
  if (!rawSessionToken) {
    return noStoreJson({ ok: false, code: "unauthorized" }, 401);
  }

  let body: {
    action?: PilotAction;
    projectionId?: string | null;
    effectiveAt?: string | null;
    reportedTitle?: string | null;
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
  ]);

  if (!body.action || !allowed.has(body.action)) {
    return noStoreJson({ ok: false, code: "unsupported_action" }, 400);
  }

  if (body.effectiveAt && Number.isNaN(Date.parse(body.effectiveAt))) {
    return noStoreJson({ ok: false, code: "invalid_effective_at" }, 400);
  }

  const supabase = createAtlasAdminClient();
  const { data, error } = await supabase.rpc(
    "worker_delivery_pilot_transition_v1",
    {
      p_session_token_hash: hashAnnaPilotToken(rawSessionToken),
      p_action: body.action,
      p_projection_id: body.projectionId ?? null,
      p_effective_at: body.effectiveAt ?? null,
      p_reported_title: body.reportedTitle?.trim() || null,
    },
  );

  if (error) {
    console.error("Anna Worker Day pilot transition failed:", error);
    return noStoreJson({ ok: false, code: "pilot_transition_failed" }, 500);
  }

  const result = (data ?? {}) as PilotTransitionResult;
  if (result.ok === true) {
    return noStoreJson(result as Record<string, unknown>);
  }

  if (result.code === "attention_conflict") {
    return noStoreJson(result as Record<string, unknown>, 409);
  }

  if (result.code === "unauthorized") {
    return noStoreJson(result as Record<string, unknown>, 401);
  }

  return noStoreJson(result as Record<string, unknown>, 400);
}
