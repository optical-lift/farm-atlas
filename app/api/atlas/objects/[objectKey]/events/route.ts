import { NextRequest, NextResponse } from "next/server";

import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ objectKey: string }> };

const EVENT_TYPES = new Set([
  "observed",
  "checked",
  "weeded",
  "watered",
  "sowed",
  "planted",
  "germinated",
  "pinched",
  "bloom_started",
  "harvested",
  "maintained",
  "cleared",
  "blocked",
]);

type EventBody = {
  eventType?: string;
  eventDate?: string;
  note?: string;
  quantity?: number;
  unit?: string;
  cropCycleId?: string;
  plantInstanceId?: string;
  idempotencyKey?: string;
};

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validUuid(value: string | undefined) {
  return !value || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const requestOrigin = request.headers.get("origin");
    if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, error: "Object events require a same-origin request." }, { status: 403 });
    }
    if (request.headers.get("x-atlas-intent") !== "object-event-v1") {
      return NextResponse.json({ ok: false, error: "Object event intent header is required." }, { status: 403 });
    }

    const { objectKey: rawObjectKey } = await context.params;
    const objectKey = rawObjectKey.trim();
    const body = (await request.json()) as EventBody;
    const eventType = body.eventType?.trim() ?? "";
    const eventDate = body.eventDate?.trim() ?? "";
    const note = body.note?.trim() || null;
    const unit = body.unit?.trim() || null;
    const idempotencyKey = body.idempotencyKey?.trim() ?? "";

    if (!objectKey || objectKey.length > 160) {
      return NextResponse.json({ ok: false, error: "A valid object key is required." }, { status: 400 });
    }
    if (!EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ ok: false, error: "Choose a valid object event." }, { status: 400 });
    }
    if (!validDate(eventDate)) {
      return NextResponse.json({ ok: false, error: "Choose a valid event date." }, { status: 400 });
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
    if (body.quantity !== undefined && eventType !== "harvested") {
      return NextResponse.json({ ok: false, error: "Quantity is only used for harvest events." }, { status: 400 });
    }
    if (!validUuid(body.cropCycleId) || !validUuid(body.plantInstanceId)) {
      return NextResponse.json({ ok: false, error: "The selected crop or plant link is invalid." }, { status: 400 });
    }
    if (body.cropCycleId && body.plantInstanceId) {
      return NextResponse.json({ ok: false, error: "Choose one crop or permanent plant target." }, { status: 400 });
    }

    const { data, error } = await atlasSupabase.schema("atlas").rpc("record_object_event_v1", {
      p_farm_key: "elm_farm",
      p_object_key: objectKey,
      p_event_type: eventType,
      p_event_date: eventDate,
      p_note: note,
      p_quantity: body.quantity ?? null,
      p_unit: unit,
      p_crop_cycle_id: body.cropCycleId ?? null,
      p_plant_instance_id: body.plantInstanceId ?? null,
      p_state: {},
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      const status = error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 500;
      return NextResponse.json(
        { ok: false, error: "Atlas could not record this object event.", details: error.message },
        { status },
      );
    }

    return NextResponse.json({ ok: true, result: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Atlas object event write failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Atlas object event write failed.",
        details: error instanceof Error ? error.message : "Unknown object event error.",
      },
      { status: 500 },
    );
  }
}
