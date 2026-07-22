import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  buildCloseoutSummary,
  closeoutPeriodBounds,
  type CloseoutPeriod,
  type CloseoutSource,
} from "@/lib/atlas-data/closeout";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "closeout-membership-v1",
    },
  });
}

export async function GET() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const today = new Date().toISOString().slice(0, 10);
  const periods: CloseoutPeriod[] = ["day", "week", "month"];
  const supabase = await createAtlasServerClient();

  try {
    const summaries = await Promise.all(periods.map(async (period) => {
      const bounds = closeoutPeriodBounds(today, period);
      const { data, error } = await supabase.rpc("closeout_summary_source_v1", {
        p_farm_id: authorized.access.membership.farmId,
        p_start_date: bounds.start,
        p_end_date: bounds.end,
      });

      if (error) throw error;
      return buildCloseoutSummary((data ?? {}) as CloseoutSource, today, period);
    }));

    return privateJson({ ok: true, today, summaries });
  } catch (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "Active Elm Farm membership required." }, 403);
    }
    console.error("Atlas closeout load failed:", error);
    return privateJson({ ok: false, error: "Atlas closeout load failed." }, 500);
  }
}
