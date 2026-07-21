import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  loadProductionPlans,
  loadSharedProductionPlans,
} from "@/lib/atlas-data/production";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = {
  action?: unknown;
  planId?: unknown;
  successionId?: unknown;
  plannedWindowStart?: unknown;
  protectFinalSuccession?: unknown;
  missedStrategy?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export async function GET() {
  try {
    const authorized = await requireAtlasApiAccess();
    if (!authorized.ok) return authorized.response;

    const supabase = await createAtlasServerClient();
    const role = authorized.access.membership.role;
    return NextResponse.json(
      {
        ok: true,
        role,
        canManageProduction: role === "owner",
        plans: await loadSharedProductionPlans(
          supabase,
          authorized.access.membership.farmId,
        ),
      },
      { headers: { "Cache-Control": "private, no-store", "X-Atlas-Read-Path": "production-dashboard-shared-member-v1" } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Dashboard failed." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const requestOrigin = request.headers.get("origin");
    if (!requestOrigin || requestOrigin !== request.nextUrl.origin || request.headers.get("x-atlas-intent") !== "production-dashboard-v1") {
      return NextResponse.json({ ok: false, error: "Production changes require a same-origin Atlas request." }, { status: 403 });
    }

    const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner"] });
    if (!authorized.ok) return authorized.response;

    const body = await request.json() as Body;
    const action = clean(body.action);
    const planId = clean(body.planId);
    const successionId = clean(body.successionId);
    const targetStart = clean(body.plannedWindowStart);
    const missedStrategy = clean(body.missedStrategy);

    if (action === "set_plan_policy") {
      if (!uuidPattern.test(planId) || !["skip", "merge", "preserve"].includes(missedStrategy) || typeof body.protectFinalSuccession !== "boolean") {
        return NextResponse.json({ ok: false, error: "Invalid production policy." }, { status: 400 });
      }
    } else if (action === "move_succession") {
      if (!uuidPattern.test(successionId) || !validDate(targetStart)) {
        return NextResponse.json({ ok: false, error: "Invalid succession move." }, { status: 400 });
      }
    } else {
      return NextResponse.json({ ok: false, error: "Unsupported dashboard action." }, { status: 400 });
    }

    const supabase = await createAtlasServerClient();
    const { error } = await supabase.rpc("owner_update_production_dashboard_v1", {
      p_farm_id: authorized.access.membership.farmId,
      p_action: action,
      p_plan_id: action === "set_plan_policy" ? planId : null,
      p_succession_id: action === "move_succession" ? successionId : null,
      p_target_start: action === "move_succession" ? targetStart : null,
      p_missed_strategy: action === "set_plan_policy" ? missedStrategy : null,
      p_protect_final_succession: action === "set_plan_policy" ? body.protectFinalSuccession : null,
    });

    if (error) {
      const rpcError = error as RpcError;
      const status = rpcError.code === "42501" ? 403 : rpcError.code === "P0002" ? 404 : rpcError.code === "22023" ? 400 : 500;
      return NextResponse.json({ ok: false, error: rpcError.message || "Dashboard update failed." }, { status });
    }

    return NextResponse.json(
      { ok: true, plans: await loadProductionPlans(supabase) },
      { headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "production-dashboard-owner-v1" } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Dashboard update failed." }, { status: 500 });
  }
}
