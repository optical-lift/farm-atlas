import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type CreateFieldLogBody = {
  actionTypes?: string[];
  summarySentence?: string;
  note?: string;
  createdBy?: string;
  zoneKeys?: string[];
  objectKeys?: string[];
};

const allowedActionTypes = new Set([
  "planted",
  "sowed",
  "weeded",
  "watered",
  "checked",
  "harvested",
  "moved",
  "observed",
  "maintained",
  "blocked",
  "completed",
]);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateFieldLogBody;

    const actionTypes = Array.isArray(body.actionTypes)
      ? body.actionTypes.filter((action) => allowedActionTypes.has(action))
      : [];

    const summarySentence = body.summarySentence?.trim();

    if (actionTypes.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Choose at least one valid Atlas action type.",
        },
        { status: 400 },
      );
    }

    if (!summarySentence) {
      return NextResponse.json(
        {
          ok: false,
          error: "A summary sentence is required.",
        },
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
        {
          ok: false,
          error: "Elm Farm was not found in Atlas.",
          details: farmError?.message,
        },
        { status: 500 },
      );
    }

    const { data: fieldLog, error: fieldLogError } = await atlasSupabase
      .schema("atlas")
      .from("field_logs")
      .insert({
        farm_id: farm.id,
        action_types: actionTypes,
        summary_sentence: summarySentence,
        note: body.note?.trim() || null,
        created_by: body.createdBy?.trim() || "atlas_local_test",
        source: "atlas_mobile",
      })
      .select("id, log_date, action_types, summary_sentence, note")
      .single();

    if (fieldLogError || !fieldLog) {
      return NextResponse.json(
        {
          ok: false,
          error: "Atlas field log insert failed.",
          details: fieldLogError?.message,
        },
        { status: 500 },
      );
    }

    const zoneKeys = Array.isArray(body.zoneKeys) ? body.zoneKeys : [];
    const objectKeys = Array.isArray(body.objectKeys) ? body.objectKeys : [];

    if (zoneKeys.length > 0) {
      const { data: zones, error: zonesError } = await atlasSupabase
        .schema("atlas")
        .from("zones")
        .select("id, stable_key")
        .eq("farm_id", farm.id)
        .in("stable_key", zoneKeys);

      if (zonesError) {
        return NextResponse.json(
          {
            ok: false,
            error: "Atlas zone lookup failed after field log insert.",
            details: zonesError.message,
            fieldLog,
          },
          { status: 500 },
        );
      }

      if (zones && zones.length > 0) {
        const { error: linkZonesError } = await atlasSupabase
          .schema("atlas")
          .from("field_log_objects")
          .insert(
            zones.map((zone) => ({
              field_log_id: fieldLog.id,
              zone_id: zone.id,
              role: "touched",
            })),
          );

        if (linkZonesError) {
          return NextResponse.json(
            {
              ok: false,
              error: "Atlas zone link insert failed after field log insert.",
              details: linkZonesError.message,
              fieldLog,
            },
            { status: 500 },
          );
        }
      }
    }

    if (objectKeys.length > 0) {
      const { data: objects, error: objectsError } = await atlasSupabase
        .schema("atlas")
        .from("growing_objects")
        .select("id, zone_id, stable_key")
        .eq("farm_id", farm.id)
        .in("stable_key", objectKeys);

      if (objectsError) {
        return NextResponse.json(
          {
            ok: false,
            error: "Atlas object lookup failed after field log insert.",
            details: objectsError.message,
            fieldLog,
          },
          { status: 500 },
        );
      }

      if (objects && objects.length > 0) {
        const { error: linkObjectsError } = await atlasSupabase
          .schema("atlas")
          .from("field_log_objects")
          .insert(
            objects.map((object) => ({
              field_log_id: fieldLog.id,
              zone_id: object.zone_id,
              object_id: object.id,
              role: "touched",
            })),
          );

        if (linkObjectsError) {
          return NextResponse.json(
            {
              ok: false,
              error: "Atlas object link insert failed after field log insert.",
              details: linkObjectsError.message,
              fieldLog,
            },
            { status: 500 },
          );
        }

        const todayIso = new Date().toISOString().slice(0, 10);
        const statePatch: Record<string, string | boolean> = {
          last_touched_at: todayIso,
        };

        if (actionTypes.includes("weeded")) {
          statePatch.last_weeded_at = todayIso;
        }

        if (actionTypes.includes("watered")) {
          statePatch.last_watered_at = todayIso;
          statePatch.water_status = "irrigated";
        }

        if (actionTypes.includes("checked")) {
          statePatch.last_checked_at = todayIso;
        }

        const { error: stateError } = await atlasSupabase
          .schema("atlas")
          .from("object_state")
          .update(statePatch)
          .in(
            "object_id",
            objects.map((object) => object.id),
          );

        if (stateError) {
          return NextResponse.json(
            {
              ok: false,
              error: "Atlas object state update failed after field log insert.",
              details: stateError.message,
              fieldLog,
            },
            { status: 500 },
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      fieldLog,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Atlas field log route failed.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}