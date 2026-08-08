import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession, membershipForFarm } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const requestedFarmId = request.nextUrl.searchParams.get("farmId");
  const farmId = requestedFarmId && membershipForFarm(session, requestedFarmId)
    ? requestedFarmId
    : session.activeFarmId;
  if (!farmId || !membershipForFarm(session, farmId)) {
    return NextResponse.json({ ok: false, error: "farm membership required" }, { status: 403 });
  }

  const supabase = await createAtlasServerClient();
  const [{ data: state, error: stateError }, { data: status, error: statusError }] = await Promise.all([
    supabase.rpc("sky_state_at_v2", { p_farm_id: farmId, p_at: new Date().toISOString() }),
    supabase.rpc("sky_ledger_status_v1", { p_farm_id: farmId }),
  ]);

  if (stateError) {
    return NextResponse.json({ ok: false, error: stateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    authority: "canonical_atlas_sky_ledger",
    state,
    ledger: statusError ? null : status,
    taskGuidanceIncluded: false,
    note: "This endpoint reports measured sky state only. Task timing is resolved separately by approved operation rules.",
  });
}
