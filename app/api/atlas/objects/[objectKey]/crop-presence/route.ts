import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ objectKey: string }> };

type CropPresenceBody = {
  cropLabel?: string;
  observedDate?: string;
  note?: string;
  idempotencyKey?: string;
};

type RpcError = { code?: string; message?: string };

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const requestOrigin = request.headers.get("origin");
    if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, error: "Crop presence requires a same-origin request." }, { status: 403 });
    }
    if (request.headers.get("x-atlas-intent") !== "crop-presence-v1") {
      return NextResponse.json({ ok: false, error: "Crop presence intent header is required." }, { status: 403 });
    }

    const authorized = await requireAtlasApiAccess();
    if (!authorized.ok) return authorized.response;

    const { objectKey: rawObjectKey } = await context.params;
    const objectKey = rawObjectKey.trim();
    const body = (await request.json()) as CropPresenceBody;
    const cropLabel = body.cropLabel?.trim() ?? "";
    const observedDate = body.observedDate?.trim() ?? "";
    const note = body.note?.trim() || null;
    const idempotencyKey = body.idempotencyKey?.trim() ?? "";

    if (!objectKey || objectKey.length > 160) return NextResponse.json({ ok: false, error: "A valid bed key is required." }, { status: 400 });
    if (!cropLabel || cropLabel.length > 120) return NextResponse.json({ ok: false, error: "Enter a crop name under 120 characters." }, { status: 400 });
    if (!validDate(observedDate)) return NextResponse.json({ ok: false, error: "Choose a valid observation date." }, { status: 400 });
    if (note && note.length > 2000) return NextResponse.json({ ok: false, error: "Keep the crop note under 2,000 characters." }, { status: 400 });
    if (!idempotencyKey || idempotencyKey.length > 160) return NextResponse.json({ ok: false, error: "A valid save key is required." }, { status: 400 });

    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("record_observed_crop_presence_for_member_v1", {
      p_farm_id: authorized.access.membership.farmId,
      p_object_key: objectKey,
      p_crop_label: cropLabel,
      p_observed_date: observedDate,
      p_note: note,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      const rpcError = error as RpcError;
      const status = rpcError.code === "42501" ? 403 : rpcError.code === "P0002" ? 404 : rpcError.code === "22023" ? 400 : 500;
      return NextResponse.json({ ok: false, error: "Atlas could not add this crop to the bed.", details: rpcError.message }, { status });
    }

    return NextResponse.json({ ok: true, result: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Atlas crop presence write failed:", error);
    return NextResponse.json({ ok: false, error: "Atlas crop presence write failed.", details: error instanceof Error ? error.message : "Unknown crop presence error." }, { status: 500 });
  }
}