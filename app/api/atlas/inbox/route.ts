import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type InboxPayload = {
  body?: string;
  zoneKey?: string | null;
  createdBy?: string;
};

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as InboxPayload;
    const body = payload.body?.trim();
    const zoneKey = payload.zoneKey?.trim() || null;

    if (!body) {
      return NextResponse.json(
        { ok: false, error: "Inbox note cannot be blank." },
        { status: 400 },
      );
    }

    const { data: farm, error: farmError } = await atlasSupabase
      .schema("atlas")
      .from("farms")
      .select("id")
      .eq("stable_key", "elm_farm")
      .single();

    if (farmError || !farm) {
      return NextResponse.json(
        { ok: false, error: "Elm Farm was not found.", details: farmError?.message },
        { status: 500 },
      );
    }

    let zoneId: string | null = null;

    if (zoneKey) {
      const { data: zone, error: zoneError } = await atlasSupabase
        .schema("atlas")
        .from("zones")
        .select("id")
        .eq("farm_id", farm.id)
        .eq("stable_key", zoneKey)
        .maybeSingle();

      if (zoneError) {
        return NextResponse.json(
          { ok: false, error: "Zone lookup failed.", details: zoneError.message },
          { status: 500 },
        );
      }

      zoneId = zone?.id ?? null;
    }

    const { data: inboxItem, error: insertError } = await atlasSupabase
      .schema("atlas")
      .from("inbox_items")
      .insert({
        farm_id: farm.id,
        zone_id: zoneId,
        item_type: "field_note",
        status: "new",
        body,
        created_by: null,
        source: "atlas_home_inbox",
        metadata: {
          zone_key: zoneKey,
        },
      })
      .select("id, status, body, created_at")
      .single();

    if (insertError || !inboxItem) {
      return NextResponse.json(
        { ok: false, error: "Inbox note failed to save.", details: insertError?.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, inboxItem });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Atlas inbox route failed.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
