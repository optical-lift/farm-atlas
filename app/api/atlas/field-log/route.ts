import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CreateFieldLogBody = {
  actionTypes?: string[];
  summarySentence?: string;
  note?: string;
  createdBy?: string;
  zoneKeys?: string[];
  objectKeys?: string[];
};

type RpcError = { code?: string; message?: string };

const allowedActionTypes = new Set([
  "planted", "sowed", "weeded", "watered", "checked", "harvested",
  "moved", "observed", "maintained", "blocked", "completed",
]);

function cleanKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))).slice(0, 100);
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, error: "Field logs require a same-origin request." }, { status: 403 });
    }

    const authorized = await requireAtlasApiAccess();
    if (!authorized.ok) return authorized.response;

    const body = (await request.json()) as CreateFieldLogBody;
    const actionTypes = Array.isArray(body.actionTypes)
      ? Array.from(new Set(body.actionTypes.filter((action): action is string => typeof action === "string" && allowedActionTypes.has(action))))
      : [];
    const summarySentence = body.summarySentence?.trim() ?? "";
    const note = body.note?.trim() || null;

    if (actionTypes.length === 0) {
      return NextResponse.json({ ok: false, error: "Choose at least one valid Atlas action type." }, { status: 400 });
    }
    if (!summarySentence) {
      return NextResponse.json({ ok: false, error: "A summary sentence is required." }, { status: 400 });
    }
    if (summarySentence.length > 4000 || (note?.length ?? 0) > 4000) {
      return NextResponse.json({ ok: false, error: "Field log text must be 4,000 characters or fewer." }, { status: 400 });
    }

    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("record_field_log_for_member_v1", {
      p_farm_id: authorized.access.membership.farmId,
      p_action_types: actionTypes,
      p_summary_sentence: summarySentence,
      p_note: note,
      p_zone_keys: cleanKeys(body.zoneKeys),
      p_object_keys: cleanKeys(body.objectKeys),
    });

    if (error) {
      const rpcError = error as RpcError;
      const status = rpcError.code === "42501" ? 403 : rpcError.code === "22023" ? 400 : 500;
      return NextResponse.json({ ok: false, error: "Atlas field log failed to save.", details: rpcError.message }, { status });
    }

    return NextResponse.json(
      { ok: true, fieldLog: data },
      { headers: { "Cache-Control": "private, no-store", "X-Atlas-Write-Path": "field-log-membership-v1" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Atlas field log route failed.", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
