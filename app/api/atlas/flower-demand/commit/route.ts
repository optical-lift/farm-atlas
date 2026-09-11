import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcError = { code?: string; message?: string };
type Body = {
  demandOrderId?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "flower-demand-commitment-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "Owner or Manager authority is required to commit flower demand." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "Flower demand order was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The flower-demand commitment was rejected." }, 400);
  console.error("Flower demand commitment failed.", error);
  return privateJson({ ok: false, error: "Flower demand commitment failed." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Flower demand commitment requires a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm flower-demand scope." }, 403);
  }

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON flower-demand commitment is required." }, 400);
  }

  const demandOrderId = clean(body.demandOrderId);
  const note = clean(body.note);
  const idempotencyKey = clean(body.idempotencyKey);

  if (!UUID_PATTERN.test(demandOrderId)) {
    return privateJson({ ok: false, error: "A valid flower demand order is required." }, 400);
  }
  if (!idempotencyKey || idempotencyKey.length > 160) {
    return privateJson({ ok: false, error: "A valid commitment idempotency key is required." }, 400);
  }
  if (note.length > 2000) {
    return privateJson({ ok: false, error: "The commitment note is too long." }, 400);
  }

  const supabase = await createAtlasServerClient();
  const sharedArgs = {
    p_demand_order_id: demandOrderId,
    p_note: note || null,
    p_idempotency_key: idempotencyKey,
  };

  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_commit_flower_demand_order_v1", {
        p_effective_membership_id: operatorMembershipId,
        ...sharedArgs,
      })
    : await supabase.rpc("commit_flower_demand_order_for_member_v1", {
        p_farm_id: authorized.access.membership.farmId,
        ...sharedArgs,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid flower-demand commitment receipt." }, 500);
  }

  return privateJson({
    ok: true,
    commitment: response.data,
    truthBoundary: "demand_commitment_acceptance",
    supplyClaimed: false,
    inventoryCommitted: false,
    saleRecorded: false,
    workerTimeScheduled: false,
    paymentStatus: "not_recorded",
    operatorMode: operatorContext?.isOperating ?? false,
  });
}
