import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  taskTitle?: string;
  action?: "not_yet" | "germinated";
  spacingOutcome?: "thin" | "on_target" | "patch";
  targetSpacingInches?: number | string;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uuidOrNull(value: unknown) {
  const cleaned = clean(value);
  if (!cleaned) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleaned) ? cleaned : undefined;
}

function spacingOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 && number <= 120 ? number : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, error: "Germination updates require a same-origin request." }, { status: 403 });
    }

    const authorized = await requireAtlasApiAccess();
    if (!authorized.ok) return authorized.response;

    const body = (await request.json()) as Body;
    const taskId = uuidOrNull(body.taskId);
    const taskTitle = clean(body.taskTitle) || null;
    const targetSpacing = spacingOrNull(body.targetSpacingInches);

    if (taskId === undefined) return NextResponse.json({ ok: false, error: "Choose a valid germination task." }, { status: 400 });
    if (!taskId && !taskTitle) return NextResponse.json({ ok: false, error: "Task id or title is required." }, { status: 400 });
    if (body.action !== "not_yet" && body.action !== "germinated") {
      return NextResponse.json({ ok: false, error: "Action must be not_yet or germinated." }, { status: 400 });
    }
    if (body.action === "germinated" && !["thin", "on_target", "patch"].includes(body.spacingOutcome ?? "")) {
      return NextResponse.json({ ok: false, error: "Choose thin, no action, or patch seed." }, { status: 400 });
    }
    if (targetSpacing === undefined) return NextResponse.json({ ok: false, error: "Choose a valid target spacing." }, { status: 400 });

    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("record_germination_check_for_member_v1", {
      p_farm_id: authorized.access.membership.farmId,
      p_task_id: taskId,
      p_task_title: taskTitle,
      p_action: body.action,
      p_spacing_outcome: body.action === "germinated" ? body.spacingOutcome ?? null : null,
      p_target_spacing_inches: targetSpacing,
    });

    if (error) {
      const rpcError = error as RpcError;
      const status = rpcError.code === "42501" ? 403 : rpcError.code === "P0002" ? 404 : rpcError.code === "22023" ? 400 : 500;
      return NextResponse.json({ ok: false, error: "Germination check update failed.", details: rpcError.message }, { status });
    }

    const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "germination-membership-v1" } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Germination check update failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
