import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

type IntakeInput = {
  idempotencyKey?: string;
  cropLabel?: string;
  batchLabel?: string;
  containerKind?: string;
  trayCount?: number;
  status?: string;
  cropProfileId?: string | null;
  variety?: string | null;
  liveQuantity?: number | null;
  sownDate?: string | null;
  seedsSown?: number | null;
  locationObjectId?: string | null;
  destinationObjectId?: string | null;
  sourceObjectId?: string | null;
  actionKey?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
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

  let input: IntakeInput;
  try {
    input = await request.json() as IntakeInput;
  } catch {
    return privateJson({ ok: false, error: "Grow Room intake must be valid JSON." }, 400);
  }

  const idempotencyKey = input.idempotencyKey?.trim();
  const cropLabel = input.cropLabel?.trim();
  const batchLabel = input.batchLabel?.trim();
  const containerKind = input.containerKind?.trim();
  const trayCount = input.trayCount;
  const status = input.status?.trim();

  if (!idempotencyKey || !cropLabel || !batchLabel || !containerKind || !status || !Number.isFinite(trayCount) || Number(trayCount) <= 0) {
    return privateJson({
      ok: false,
      error: "Crop, batch label, container, positive tray count, stage, and idempotency key are required.",
    }, 400);
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("grow_room_intake_batch_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_idempotency_key: idempotencyKey,
    p_crop_label: cropLabel,
    p_batch_label: batchLabel,
    p_container_kind: containerKind,
    p_tray_count: trayCount,
    p_status: status,
    p_crop_profile_id: input.cropProfileId ?? null,
    p_variety: input.variety ?? null,
    p_live_quantity: input.liveQuantity ?? null,
    p_sown_date: input.sownDate ?? null,
    p_seeds_sown: input.seedsSown ?? null,
    p_location_object_id: input.locationObjectId ?? null,
    p_destination_object_id: input.destinationObjectId ?? null,
    p_source_object_id: input.sourceObjectId ?? null,
    p_action_key: input.actionKey ?? null,
    p_note: input.note ?? null,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    console.error("Grow Room intake failed:", error);
    return privateJson({ ok: false, error: error.message || "Grow Room intake failed." }, rpcStatus(error as RpcError));
  }

  return privateJson({ ok: true, result: data });
}
