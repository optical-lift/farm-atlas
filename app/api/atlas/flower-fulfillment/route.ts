import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { effectiveOperatorMembershipId, readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
type RpcError = { code?: string; message?: string };
function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function privateJson(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "flower-fulfillment-v1" } }); }
function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This fulfillment is outside the active worker context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "Fulfillment task was not found." }, 404);
  if (["22023", "22P02", "23505"].includes(error.code || "")) return privateJson({ ok: false, error: error.message || "The fulfillment result was rejected." }, 400);
  console.error("Flower fulfillment result failed.", error);
  return privateJson({ ok: false, error: "Flower fulfillment result failed." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) return privateJson({ ok: false, error: "Flower fulfillment requires a same-origin Atlas request." }, 403);
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return privateJson({ ok: false, error: "A JSON fulfillment result is required." }, 400); }
  const taskId = clean(body.taskId);
  const idempotencyKey = clean(body.idempotencyKey);
  const note = clean(body.note) || null;
  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid task id is required." }, 400);
  if (!idempotencyKey) return privateJson({ ok: false, error: "An idempotency key is required." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) return privateJson({ ok: false, error: "The selected account has no fulfillment scope." }, 403);
  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_flower_fulfillment_v1", { p_effective_membership_id: operatorMembershipId, p_task_id: taskId, p_note: note, p_idempotency_key: idempotencyKey })
    : await supabase.rpc("record_flower_fulfillment_for_member_v1", { p_farm_id: authorized.access.membership.farmId, p_task_id: taskId, p_note: note, p_idempotency_key: idempotencyKey });
  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) return privateJson({ ok: false, error: "Atlas returned an invalid fulfillment result." }, 500);
  return privateJson({ ...(response.data as Record<string, unknown>), ok: true, operatorMode: operatorContext?.isOperating ?? false, effectiveMembershipId: operatorMembershipId });
}
