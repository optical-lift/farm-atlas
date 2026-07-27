import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

type DestinationInput = {
  batchId?: string;
  destinationObjectId?: string;
  idempotencyKey?: string;
  note?: string | null;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

function rpcStatus(error: RpcError) {
  if (error.code === "42501") return 403;
  if (error.code === "P0002") return 404;
  if (error.code === "22023") return 400;
  return 500;
}

export async function POST(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let input: DestinationInput;
  try {
    input = await request.json() as DestinationInput;
  } catch {
    return privateJson({ ok: false, error: "Destination assignment must be valid JSON." }, 400);
  }

  const batchId = input.batchId?.trim();
  const destinationObjectId = input.destinationObjectId?.trim();
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!batchId || !destinationObjectId || !idempotencyKey) {
    return privateJson({ ok: false, error: "Batch, destination, and idempotency key are required." }, 400);
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("grow_room_assign_destination_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_batch_id: batchId,
    p_destination_object_id: destinationObjectId,
    p_idempotency_key: idempotencyKey,
    p_note: input.note ?? null,
  });

  if (error) {
    console.error("Grow Room destination assignment failed:", error);
    return privateJson({ ok: false, error: error.message || "Grow Room destination assignment failed." }, rpcStatus(error as RpcError));
  }

  return privateJson({ ok: true, result: data });
}
