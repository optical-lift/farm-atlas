import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type FarmRow = { id: string; stable_key: string; name: string };
type ScoreRow = {
  farm_id: string;
  ready_lot_count: number | string;
  unpriced_ready_lot_count: number | string;
  valuation_complete: boolean;
  priced_prepared_retail_value: number | string;
  priced_claimed_retail_value: number | string;
  priced_disposed_retail_value: number | string;
  sell_through_pct: number | string | null;
  active_order_count: number | string;
  fulfilled_order_count: number | string;
  cancelled_order_count: number | string;
  committed_revenue: number | string;
  realized_revenue: number | string;
  realized_total_receipts: number | string;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function number(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);

  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));
  if (!farmIds.length) return privateJson({ ok: true, farms: [] });

  const supabase = await createAtlasServerClient();
  const [farmsResult, scoreResult] = await Promise.all([
    supabase.from("farms").select("id, stable_key, name").in("id", farmIds),
    supabase.from("flower_commercial_farm_score_v1").select("farm_id, ready_lot_count, unpriced_ready_lot_count, valuation_complete, priced_prepared_retail_value, priced_claimed_retail_value, priced_disposed_retail_value, sell_through_pct, active_order_count, fulfilled_order_count, cancelled_order_count, committed_revenue, realized_revenue, realized_total_receipts").in("farm_id", farmIds),
  ]);

  const error = farmsResult.error || scoreResult.error;
  if (error) return privateJson({ ok: false, error: "Harvest commercial score could not be loaded." }, 500);

  const scores = new Map(((scoreResult.data ?? []) as ScoreRow[]).map((row) => [row.farm_id, row]));
  const farms = ((farmsResult.data ?? []) as FarmRow[]).map((farm) => {
    const score = scores.get(farm.id);
    return {
      id: farm.id,
      key: farm.stable_key,
      name: farm.name,
      readyLotCount: number(score?.ready_lot_count),
      unpricedReadyLotCount: number(score?.unpriced_ready_lot_count),
      valuationComplete: score?.valuation_complete ?? true,
      preparedRetailValue: number(score?.priced_prepared_retail_value),
      claimedRetailValue: number(score?.priced_claimed_retail_value),
      disposedRetailValue: number(score?.priced_disposed_retail_value),
      sellThroughPct: score?.sell_through_pct === null || score?.sell_through_pct === undefined ? null : number(score.sell_through_pct),
      activeOrderCount: number(score?.active_order_count),
      fulfilledOrderCount: number(score?.fulfilled_order_count),
      cancelledOrderCount: number(score?.cancelled_order_count),
      committedRevenue: number(score?.committed_revenue),
      realizedRevenue: number(score?.realized_revenue),
      realizedTotalReceipts: number(score?.realized_total_receipts),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));

  return privateJson({ ok: true, farms });
}
