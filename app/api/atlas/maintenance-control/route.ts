import { NextRequest, NextResponse } from "next/server";

import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type ControlBody = {
  maintenanceObjectId?: string;
  action?: "owner_override" | "condition";
  enabled?: boolean;
  condition?: "maintained" | "moderate" | "heavy" | "reset";
  reportedMinutes?: number | null;
};

export async function POST(request: NextRequest) {
  let body: ControlBody;

  try {
    body = (await request.json()) as ControlBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.maintenanceObjectId || !body.action) {
    return NextResponse.json(
      { ok: false, error: "maintenanceObjectId and action are required." },
      { status: 400 },
    );
  }

  if (body.action === "owner_override") {
    const { data, error } = await atlasSupabase
      .schema("atlas")
      .from("maintenance_objects")
      .update({
        owner_priority: body.enabled === false ? 0 : 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.maintenanceObjectId)
      .select("id, owner_priority")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "Owner override update failed.", details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, action: body.action, maintenanceObject: data });
  }

  if (!body.condition) {
    return NextResponse.json({ ok: false, error: "condition is required." }, { status: 400 });
  }

  const reportedMinutes =
    typeof body.reportedMinutes === "number" && Number.isFinite(body.reportedMinutes)
      ? Math.max(1, Math.round(body.reportedMinutes))
      : null;

  const { data, error } = await atlasSupabase
    .schema("atlas")
    .rpc("set_maintenance_condition", {
      p_maintenance_object_id: body.maintenanceObjectId,
      p_condition: body.condition,
      p_reported_minutes: reportedMinutes,
    });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Condition update failed.", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, action: body.action, maintenanceObject: data });
}
