import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { loadProductionPlans } from "@/lib/atlas-data/production";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = new Set(["upcoming", "in_window", "late", "skipped", "sown", "germinated", "harvesting", "cleared"]);

type Body = {
  action?: unknown;
  planId?: unknown;
  successionId?: unknown;
  state?: unknown;
  actualSowDate?: unknown;
  successionCount?: unknown;
  spacingDays?: unknown;
  firstWindowStart?: unknown;
  windowLengthDays?: unknown;
  lateWindowDays?: unknown;
  missedStrategy?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : null;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export async function GET() {
  try {
    const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
    if (!authorized.ok) return authorized.response;
    const supabase = await createAtlasServerClient();
    return NextResponse.json(
      { ok: true, plans: await loadProductionPlans(supabase) },
      { headers: { "Cache-Control": "private, no-store", "X-Atlas-Read-Path": "production-membership-v1" } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Production plans failed." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const requestOrigin = request.headers.get("origin");
    if (!requestOrigin || requestOrigin !== request.nextUrl.origin || request.headers.get("x-atlas-intent") !== "production-plan-v1") {
      return NextResponse.json({ ok: false, error: "Production changes require a same-origin Atlas request." }, { status: 403 });
    }

    const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner"] });
    if (!authorized.ok) return authorized.response;
    const body = await request.json() as Body;
    const action = clean(body.action);

    let rpcArgs: Record<string, unknown>;
    if (action === "set_succession_state") {
      const successionId = clean(body.successionId);
      const state = clean(body.state);
      const actualSowDate = clean(body.actualSowDate);
      if (!uuidPattern.test(successionId) || !states.has(state)) {
        return NextResponse.json({ ok: false, error: "Invalid succession state update." }, { status: 400 });
      }
      if (state === "sown" && !validDate(actualSowDate)) {
        return NextResponse.json({ ok: false, error: "A valid sow date is required." }, { status: 400 });
      }
      rpcArgs = {
        p_farm_id: authorized.access.membership.farmId,
        p_action: action,
        p_plan_id: null,
        p_succession_id: successionId,
        p_state: state,
        p_actual_sow_date: state === "sown" ? actualSowDate : null,
        p_succession_count: null,
        p_spacing_days: null,
        p_first_window_start: null,
        p_window_length_days: null,
        p_late_window_days: null,
        p_missed_strategy: null,
      };
    } else if (action === "regenerate") {
      const planId = clean(body.planId);
      const firstWindowStart = clean(body.firstWindowStart);
      const successionCount = integer(body.successionCount);
      const spacingDays = integer(body.spacingDays);
      const windowLengthDays = integer(body.windowLengthDays);
      const lateWindowDays = integer(body.lateWindowDays);
      const missedStrategy = clean(body.missedStrategy);
      if (!uuidPattern.test(planId) || !validDate(firstWindowStart)
        || successionCount === null || successionCount < 1 || successionCount > 60
        || spacingDays === null || spacingDays < 0 || spacingDays > 120
        || windowLengthDays === null || windowLengthDays < 0 || windowLengthDays > 45
        || lateWindowDays === null || lateWindowDays < 0 || lateWindowDays > 45
        || !["skip", "merge", "preserve"].includes(missedStrategy)) {
        return NextResponse.json({ ok: false, error: "Invalid production plan settings." }, { status: 400 });
      }
      rpcArgs = {
        p_farm_id: authorized.access.membership.farmId,
        p_action: action,
        p_plan_id: planId,
        p_succession_id: null,
        p_state: null,
        p_actual_sow_date: null,
        p_succession_count: successionCount,
        p_spacing_days: spacingDays,
        p_first_window_start: firstWindowStart,
        p_window_length_days: windowLengthDays,
        p_late_window_days: lateWindowDays,
        p_missed_strategy: missedStrategy,
      };
    } else {
      return NextResponse.json({ ok: false, error: "Unsupported production plan action." }, { status: 400 });
    }

    const supabase = await createAtlasServerClient();
    const { error } = await supabase.rpc("owner_update_production_plan_v1", rpcArgs);
    if (error) {
      const rpcError = error as RpcError;
      const status = rpcError.code === "42501" ? 403 : rpcError.code === "P0002" ? 404 : rpcError.code === "22023" ? 400 : 500;
      return NextResponse.json({ ok: false, error: rpcError.message || "Production update failed." }, { status });
    }

    return NextResponse.json(
      { ok: true, plans: await loadProductionPlans(supabase) },
      { headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "production-plan-owner-v1" } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Production update failed." }, { status: 500 });
  }
}
