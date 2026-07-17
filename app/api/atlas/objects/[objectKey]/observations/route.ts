import { NextRequest, NextResponse } from "next/server";

import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ objectKey: string }> };

const OBSERVATION_KEYS = new Set([
  "germinated",
  "established",
  "vegetative",
  "budding",
  "flowering",
  "fruit_set",
  "first_harvest",
  "peak_harvest",
  "slowing",
  "finished",
  "failed",
  "dormant",
  "cleared",
  "not_ready",
  "changed_plan",
]);

type ObservationBody = {
  cropCycleId?: string;
  observationKey?: string;
  eventDate?: string;
  note?: string;
  quantity?: number;
  unit?: string;
  idempotencyKey?: string;
};

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const requestOrigin = request.headers.get("origin");
    if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, error: "Crop observations require a same-origin request." }, { status: 403 });
    }
    if (request.headers.get("x-atlas-intent") !== "crop-observation-v1") {
      return NextResponse.json({ ok: false, error: "Crop observation intent header is required." }, { status: 403 });
    }

    const { objectKey: rawObjectKey } = await context.params;
    const objectKey = rawObjectKey.trim();
    const body = (await request.json()) as ObservationBody;
    const cropCycleId = body.cropCycleId?.trim() ?? "";
    const observationKey = body.observationKey?.trim() ?? "";
    const eventDate = body.eventDate?.trim() ?? "";
    const note = body.note?.trim() || null;
    const unit = body.unit?.trim() || null;
    const idempotencyKey = body.idempotencyKey?.trim() ?? "";

    if (!objectKey || objectKey.length > 160) {
      return NextResponse.json({ ok: false, error: "A valid object key is required." }, { status: 400 });
    }
    if (!validUuid(cropCycleId)) {
      return NextResponse.json({ ok: false, error: "Choose a valid crop." }, { status: 400 });
    }
    if (!OBSERVATION_KEYS.has(observationKey)) {
      return NextResponse.json({ ok: false, error: "Choose a valid crop observation." }, { status: 400 });
    }
    if (!validDate(eventDate)) {
      return NextResponse.json({ ok: false, error: "Choose a valid observation date." }, { status: 400 });
    }
    if (!idempotencyKey || idempotencyKey.length > 160) {
      return NextResponse.json({ ok: false, error: "A valid save key is required." }, { status: 400 });
    }
    if (note && note.length > 4000) {
      return NextResponse.json({ ok: false, error: "Keep the note under 4,000 characters." }, { status: 400 });
    }
    if (unit && unit.length > 40) {
      return NextResponse.json({ ok: false, error: "Keep the unit under 40 characters." }, { status: 400 });
    }
    if (body.quantity !== undefined && (!Number.isFinite(body.quantity) || body.quantity < 0)) {
      return NextResponse.json({ ok: false, error: "Quantity must be zero or greater." }, { status: 400 });
    }

    const { data, error } = await atlasSupabase.schema("atlas").rpc("record_crop_observation_v1", {
      p_farm_key: "elm_farm",
      p_object_key: objectKey,
      p_crop_cycle_id: cropCycleId,
      p_observation_key: observationKey,
      p_event_date: eventDate,
      p_note: note,
      p_quantity: body.quantity ?? null,
      p_unit: unit,
      p_state: {},
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      const status = error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 500;
      return NextResponse.json(
        { ok: false, error: "Atlas could not record this crop observation.", details: error.message },
        { status },
      );
    }

    return NextResponse.json({ ok: true, result: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Atlas crop observation write failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Atlas crop observation write failed.",
        details: error instanceof Error ? error.message : "Unknown crop observation error.",
      },
      { status: 500 },
    );
  }
}
