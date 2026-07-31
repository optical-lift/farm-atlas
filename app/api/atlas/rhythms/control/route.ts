import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_ACTIONS = new Set(["extend", "forgive", "pause_rule", "resume_rule", "revise"]);

type ControlBody = {
  stateId?: unknown;
  action?: unknown;
  reason?: unknown;
  extensionSeconds?: unknown;
  validitySeconds?: unknown;
  warningSeconds?: unknown;
  graceSeconds?: unknown;
  idempotencyKey?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function wholeNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && Number.isInteger(number) ? number : null;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "owner-biological-rhythm-control-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: "Only the farm Owner may change this Rulebook entry." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Biological rhythm was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The Rulebook change was rejected." }, 400);
  console.error("Biological rhythm control failed", error);
  return privateJson({ ok: false, error: "Atlas could not update the biological Rulebook." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Rulebook changes require a same-origin Atlas request." }, 403);
  }

  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in to Atlas first." }, 401);
  if (!session.memberships.some((membership) => membership.role === "owner")) {
    return privateJson({ ok: false, error: "Only a farm Owner may change biological rhythms." }, 403);
  }

  let body: ControlBody;
  try {
    body = await request.json() as ControlBody;
  } catch {
    return privateJson({ ok: false, error: "A JSON Rulebook change is required." }, 400);
  }

  const stateId = clean(body.stateId);
  const action = clean(body.action);
  const reason = clean(body.reason);
  const idempotencyKey = clean(body.idempotencyKey) || null;
  if (!UUID_PATTERN.test(stateId)) return privateJson({ ok: false, error: "A valid rhythm state is required." }, 400);
  if (!CONTROL_ACTIONS.has(action)) return privateJson({ ok: false, error: "Choose a supported Rulebook action." }, 400);
  if (!reason) return privateJson({ ok: false, error: "Record the Owner reason first." }, 400);

  const supabase = await createAtlasServerClient();
  if (action === "revise") {
    const validitySeconds = wholeNumber(body.validitySeconds);
    const warningSeconds = wholeNumber(body.warningSeconds);
    const graceSeconds = wholeNumber(body.graceSeconds);
    if (!validitySeconds || validitySeconds < 3600 || warningSeconds === null || warningSeconds < 0 || graceSeconds === null || graceSeconds < 0) {
      return privateJson({ ok: false, error: "Enter valid cadence values." }, 400);
    }
    const { data, error } = await supabase.rpc("owner_revise_biological_rhythm_rule_v1", {
      p_state_id: stateId,
      p_validity_seconds: validitySeconds,
      p_warning_seconds: warningSeconds,
      p_grace_seconds: graceSeconds,
      p_reason: reason,
    });
    if (error) return rpcFailure(error as RpcError);
    return privateJson({ ok: true, result: data });
  }

  const extensionSeconds = action === "extend" ? wholeNumber(body.extensionSeconds) : null;
  const { data, error } = await supabase.rpc("owner_control_biological_rhythm_v1", {
    p_state_id: stateId,
    p_action: action,
    p_reason: reason,
    p_extension_seconds: extensionSeconds,
    p_idempotency_key: idempotencyKey,
  });
  if (error) return rpcFailure(error as RpcError);
  return privateJson({ ok: true, result: data });
}
