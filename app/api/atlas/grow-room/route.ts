import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

type GrowRoomActionInput = {
  batchId?: string;
  actionKey?: string;
  idempotencyKey?: string;
  quantity?: number | null;
  unit?: string | null;
  actionDate?: string | null;
  locationObjectId?: string | null;
  destinationObjectId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
};

function centralDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "grow-room-state-v1",
    },
  });
}

function rpcStatus(error: RpcError) {
  if (error.code === "42501") return 403;
  if (error.code === "P0002") return 404;
  if (error.code === "22023") return 400;
  return 500;
}

export async function GET() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("grow_room_state_v1", {
    p_farm_id: authorized.access.membership.farmId,
  });

  if (error) {
    console.error("Atlas Grow Room read failed:", error);
    return privateJson({
      ok: false,
      error: error.message || "Atlas Grow Room read failed.",
    }, rpcStatus(error as RpcError));
  }

  return privateJson({
    ok: true,
    farmKey: authorized.access.membership.farmKey ?? "elm_farm",
    role: authorized.access.membership.role,
    growRoom: data,
  });
}

export async function POST(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let input: GrowRoomActionInput;
  try {
    input = await request.json() as GrowRoomActionInput;
  } catch {
    return privateJson({ ok: false, error: "Grow Room action must be valid JSON." }, 400);
  }

  const batchId = input.batchId?.trim();
  const actionKey = input.actionKey?.trim();
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!batchId || !actionKey || !idempotencyKey) {
    return privateJson({ ok: false, error: "Batch, action, and idempotency key are required." }, 400);
  }
  if (["water", "watered", "watering", "moisture_check"].includes(actionKey.toLowerCase())) {
    return privateJson({
      ok: false,
      error: "Routine Grow Room watering is an automatic habit and is not logged in Atlas.",
    }, 400);
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("grow_room_record_batch_action_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_batch_id: batchId,
    p_action_key: actionKey,
    p_idempotency_key: idempotencyKey,
    p_quantity: input.quantity ?? null,
    p_unit: input.unit ?? null,
    p_action_date: input.actionDate ?? centralDateIso(),
    p_location_object_id: input.locationObjectId ?? null,
    p_destination_object_id: input.destinationObjectId ?? null,
    p_note: input.note ?? null,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    console.error("Atlas Grow Room action failed:", error);
    return privateJson({
      ok: false,
      error: error.message || "Atlas Grow Room action failed.",
    }, rpcStatus(error as RpcError));
  }

  return privateJson({ ok: true, result: data });
}
