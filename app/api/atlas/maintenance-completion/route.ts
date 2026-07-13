import { NextRequest, NextResponse } from "next/server";

import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type CompletionOutcome = "fully_completed" | "partially_completed" | "heavier_reset";

type CompletionBody = {
  maintenanceObjectId?: string;
  outcome?: CompletionOutcome;
  actualMinutes?: number | null;
  note?: string | null;
  sourceTaskId?: string | null;
};

function isCompletionOutcome(value: unknown): value is CompletionOutcome {
  return value === "fully_completed" || value === "partially_completed" || value === "heavier_reset";
}

export async function POST(request: NextRequest) {
  let body: CompletionBody;

  try {
    body = (await request.json()) as CompletionBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.maintenanceObjectId || !isCompletionOutcome(body.outcome)) {
    return NextResponse.json(
      { ok: false, error: "maintenanceObjectId and a valid outcome are required." },
      { status: 400 },
    );
  }

  const actualMinutes =
    typeof body.actualMinutes === "number" && Number.isFinite(body.actualMinutes)
      ? Math.max(0, Math.round(body.actualMinutes))
      : null;

  const { data, error } = await atlasSupabase
    .schema("atlas")
    .rpc("record_maintenance_completion", {
      p_maintenance_object_id: body.maintenanceObjectId,
      p_outcome: body.outcome,
      p_actual_minutes: actualMinutes,
      p_note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
      p_source_task_id: body.sourceTaskId || null,
    });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Maintenance completion failed.", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, completion: data });
}
