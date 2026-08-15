import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const READY_KINDS = new Set(["conditioned_bucket", "counted_stems", "posy", "bouquet", "lobby_arrangement"]);

type Body = {
  taskId?: unknown;
  outputs?: unknown;
  noSaleableOutput?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

type ReadyOutput = {
  kind: string;
  quantity: number;
  lowerBound: boolean;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "flower-preparation-ready-v1",
    },
  });
}

function parseOutputs(value: unknown): ReadyOutput[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const outputs: ReadyOutput[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const row = candidate as Record<string, unknown>;
    const kind = clean(row.kind);
    const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
    const lowerBound = row.lowerBound === true;
    if (!READY_KINDS.has(kind) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) return null;
    if (kind === "conditioned_bucket") {
      if (Math.abs(quantity * 4 - Math.round(quantity * 4)) > 1e-8) return null;
    } else {
      if (!Number.isInteger(quantity) || lowerBound) return null;
    }
    outputs.push({ kind, quantity, lowerBound });
  }
  return outputs;
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: "This preparation is outside the active worker context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Preparation task was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02" || error.code === "23505") {
    return privateJson({ ok: false, error: error.message || "The preparation result was rejected." }, 400);
  }
  console.error("Flower preparation result failed.", error);
  return privateJson({ ok: false, error: "Flower preparation result failed." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Flower preparation requires a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON preparation result is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const outputs = parseOutputs(body.outputs);
  const noSaleableOutput = body.noSaleableOutput === true;
  const note = clean(body.note) || null;
  const idempotencyKey = clean(body.idempotencyKey);

  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid task id is required." }, 400);
  if (outputs === null) return privateJson({ ok: false, error: "Ready outputs are invalid." }, 400);
  if (noSaleableOutput && outputs.length) return privateJson({ ok: false, error: "Nothing saleable cannot also create Ready inventory." }, 400);
  if (!noSaleableOutput && !outputs.length) return privateJson({ ok: false, error: "Record at least one Ready output or choose nothing saleable." }, 400);
  if (!idempotencyKey) return privateJson({ ok: false, error: "An idempotency key is required." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm preparation scope." }, 403);
  }

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_flower_preparation_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
        p_outputs: outputs,
        p_no_saleable_output: noSaleableOutput,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      })
    : await supabase.rpc("record_flower_preparation_for_member_v1", {
        p_farm_id: authorized.access.membership.farmId,
        p_task_id: taskId,
        p_outputs: outputs,
        p_no_saleable_output: noSaleableOutput,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid preparation result." }, 500);
  }

  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
    effectiveMembershipId: operatorMembershipId,
  });
}
