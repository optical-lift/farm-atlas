import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set([
  "ready",
  "small_reset_needed",
  "not_guest_ready",
  "event_damage_or_problem",
  "closed_not_in_use",
]);

type Body = {
  taskId?: unknown;
  results?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

type RpcError = { code?: string; message?: string };

type NormalizedRoomResult = {
  objectId: string;
  outcome: string;
  note: string | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "guest-readiness-clock-v1",
    },
  });
}

function normalizeResults(value: unknown): NormalizedRoomResult[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const seen = new Set<string>();
  const results: NormalizedRoomResult[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const objectId = clean(record.objectId);
    const outcome = clean(record.outcome);
    const note = clean(record.note) || null;
    if (!UUID_PATTERN.test(objectId) || !OUTCOMES.has(outcome) || seen.has(objectId)) return null;
    if (note && note.length > 2000) return null;
    if (["small_reset_needed", "not_guest_ready", "event_damage_or_problem"].includes(outcome) && !note) return null;
    seen.add(objectId);
    results.push({ objectId, outcome, note });
  }

  return results;
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This Guest Readiness round is outside the active player context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Guest Readiness task or venue record was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The readiness round was rejected." }, 400);
  console.error("Guest Readiness round failed.", error);
  return privateJson({ ok: false, error: "Guest Readiness round failed." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Guest Readiness results require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON Guest Readiness round is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const results = normalizeResults(body.results);
  const note = clean(body.note) || null;
  const idempotencyKey = clean(body.idempotencyKey);

  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid task id is required." }, 400);
  if (!results) return privateJson({ ok: false, error: "Record one valid result for every room. Rooms needing work also require a note." }, 400);
  if (!idempotencyKey || idempotencyKey.length > 160) return privateJson({ ok: false, error: "A valid idempotency key is required." }, 400);
  if (note && note.length > 4000) return privateJson({ ok: false, error: "Round note must be 4000 characters or fewer." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm Guest Readiness scope." }, 403);
  }

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_guest_readiness_round_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
        p_results: results,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      })
    : await supabase.rpc("record_guest_readiness_round_for_member_v1", {
        p_farm_id: authorized.access.membership.farmId,
        p_task_id: taskId,
        p_results: results,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid Guest Readiness result." }, 500);
  }

  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
    effectiveMembershipId: operatorMembershipId,
  });
}
