import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Body = {
  period?: "day" | "week" | "month";
  note?: string;
  carryForward?: string;
  nextFocus?: string;
};

type RpcError = { code?: string; message?: string };

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, error: "Closeouts require a same-origin request." }, { status: 403 });
    }

    const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
    if (!authorized.ok) return authorized.response;

    const body = (await request.json()) as Body;
    const period = body.period ?? "day";
    const note = body.note?.trim() ?? "";
    const carryForward = body.carryForward?.trim() || null;
    const nextFocus = body.nextFocus?.trim() || null;

    if (!["day", "week", "month"].includes(period)) {
      return NextResponse.json({ ok: false, error: "Closeout period must be day, week, or month." }, { status: 400 });
    }
    if (!note) return NextResponse.json({ ok: false, error: "Closeout note required." }, { status: 400 });
    if (note.length > 4000 || (carryForward?.length ?? 0) > 4000 || (nextFocus?.length ?? 0) > 4000) {
      return NextResponse.json({ ok: false, error: "Closeout text must be 4,000 characters or fewer." }, { status: 400 });
    }

    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("record_closeout_for_member_v1", {
      p_farm_id: authorized.access.membership.farmId,
      p_period: period,
      p_note: note,
      p_carry_forward: carryForward,
      p_next_focus: nextFocus,
    });

    if (error) {
      const rpcError = error as RpcError;
      const status = rpcError.code === "42501" ? 403 : rpcError.code === "22023" ? 400 : 500;
      return NextResponse.json({ ok: false, error: "Atlas closeout save failed.", details: rpcError.message }, { status });
    }

    const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "closeout-membership-v1" } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas closeout save failed.", details: error instanceof Error ? error.message : "Unknown closeout error." }, { status: 500 });
  }
}
