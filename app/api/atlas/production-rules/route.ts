import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { loadProductionRules } from "@/lib/atlas-data/production";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = {
  action?: unknown;
  ruleId?: unknown;
  cropProfileId?: unknown;
  seasonYear?: unknown;
  firstWindowStart?: unknown;
  finalBiologicalSowDate?: unknown;
  intendedUses?: unknown;
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
    const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
    if (!authorized.ok) return authorized.response;
    const supabase = await createAtlasServerClient();
    return NextResponse.json(
      { ok: true, rules: await loadProductionRules(supabase) },
      { headers: { "Cache-Control": "private, no-store", "X-Atlas-Read-Path": "production-rules-membership-v1" } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Production rules failed." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const requestOrigin = request.headers.get("origin");
    if (!requestOrigin || requestOrigin !== request.nextUrl.origin || request.headers.get("x-atlas-intent") !== "production-rule-v1") {
      return NextResponse.json({ ok: false, error: "Production rule actions require a same-origin Atlas request." }, { status: 403 });
    }

    const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner"] });
    if (!authorized.ok) return authorized.response;

    const body = await request.json() as Body;
    if (clean(body.action) !== "create_plan") {
      return NextResponse.json({ ok: false, error: "Unsupported production rule action." }, { status: 400 });
    }

    const ruleId = clean(body.ruleId);
    const cropProfileId = clean(body.cropProfileId);
    const firstWindowStart = clean(body.firstWindowStart);
    const finalBiologicalSowDate = clean(body.finalBiologicalSowDate);
    const seasonYear = Number(body.seasonYear);
    const intendedUses = Array.isArray(body.intendedUses)
      ? Array.from(new Set(body.intendedUses.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))).slice(0, 20)
      : [];

    if (!uuidPattern.test(ruleId)
      || (cropProfileId && !uuidPattern.test(cropProfileId))
      || !Number.isInteger(seasonYear) || seasonYear < 2026 || seasonYear > 2100
      || !validDate(firstWindowStart)
      || (finalBiologicalSowDate && !validDate(finalBiologicalSowDate))) {
      return NextResponse.json({ ok: false, error: "Invalid production rule plan settings." }, { status: 400 });
    }

    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("owner_create_production_plan_from_rule_v1", {
      p_farm_id: authorized.access.membership.farmId,
      p_rule_id: ruleId,
      p_crop_profile_id: cropProfileId || null,
      p_season_year: seasonYear,
      p_first_window_start: firstWindowStart,
      p_final_biological_sow_date: finalBiologicalSowDate || null,
      p_intended_uses: intendedUses,
    });

    if (error) {
      const rpcError = error as RpcError;
      const status = rpcError.code === "42501" ? 403 : rpcError.code === "P0002" ? 404 : rpcError.code === "22023" ? 400 : 500;
      return NextResponse.json({ ok: false, error: rpcError.message || "Production rule plan creation failed." }, { status });
    }

    const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    return NextResponse.json(
      { ok: true, planId: result.planId ?? null },
      { headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "production-rule-owner-v1" } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Production rule plan creation failed." }, { status: 500 });
  }
}
