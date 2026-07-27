import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

type StructureInput = {
  label?: string;
  structureKind?: "rack" | "shelf" | "hardening_area";
  idempotencyKey?: string;
  parentObjectId?: string | null;
  positionLabel?: string | null;
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

  let input: StructureInput;
  try {
    input = await request.json() as StructureInput;
  } catch {
    return privateJson({ ok: false, error: "Room setup must be valid JSON." }, 400);
  }

  const label = input.label?.trim();
  const structureKind = input.structureKind;
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!label || !structureKind || !idempotencyKey) {
    return privateJson({ ok: false, error: "Label, structure kind, and idempotency key are required." }, 400);
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("grow_room_create_structure_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_label: label,
    p_structure_kind: structureKind,
    p_idempotency_key: idempotencyKey,
    p_parent_object_id: input.parentObjectId ?? null,
    p_position_label: input.positionLabel ?? null,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    console.error("Grow Room structure setup failed:", error);
    return privateJson({ ok: false, error: error.message || "Grow Room structure setup failed." }, rpcStatus(error as RpcError));
  }

  return privateJson({ ok: true, result: data });
}
