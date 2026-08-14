import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { resolveOwnerWorkerDayPlanningTarget } from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const operations = new Set(["create", "change", "end", "resume"]);

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function privateJson(body: Record<string, unknown>, status = 200, mutation = false) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      [mutation ? "X-Atlas-Mutation" : "X-Atlas-Read"]: mutation ? "owner-fixed-routine-v1" : "owner-fixed-routine-list-v1",
    },
  });
}

function localTime(value: unknown) {
  if (typeof value !== "string") return "";
  return value.slice(0, 5);
}

export async function GET() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  const target = await resolveOwnerWorkerDayPlanningTarget();
  if (!target) return privateJson({ ok: false, error: "Owner worker-day planning access is required." }, 403);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .from("fixed_routines")
    .select("id, kind, title, local_start, duration_minutes, weekdays, effective_from, effective_through, active, metadata")
    .eq("farm_id", target.farmId)
    .eq("membership_id", target.membershipId)
    .order("local_start", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Atlas fixed routine list failed:", error);
    return privateJson({ ok: false, error: "Atlas could not load repeating fixed times." }, 500);
  }

  const routines = (data ?? []).map((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {};
    return {
      routineId: String(row.id),
      kind: String(row.kind),
      title: String(row.title),
      startLocalTime: localTime(row.local_start),
      durationMinutes: Number(row.duration_minutes) || 0,
      weekdays: Array.isArray(row.weekdays) ? row.weekdays.map(Number) : [],
      effectiveFrom: String(row.effective_from),
      effectiveThrough: row.effective_through ? String(row.effective_through) : null,
      active: row.active !== false,
      note: typeof metadata.operationalNote === "string" ? metadata.operationalNote : null,
    };
  });

  return privateJson({ ok: true, workerLabel: target.displayName, routines });
}

export async function POST(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  if (request.headers.get("x-atlas-intent") !== "owner-fixed-routine-v1") {
    return privateJson({ ok: false, error: "Explicit fixed-routine intent is required." }, 409, true);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return privateJson({ ok: false, error: "Fixed routine command body must be valid JSON." }, 400, true);
  }

  const operation = body.operation;
  const routineId = body.routineId;
  if (!isUuid(routineId)) return privateJson({ ok: false, error: "A valid routine ID is required." }, 400, true);
  if (typeof operation !== "string" || !operations.has(operation)) {
    return privateJson({ ok: false, error: "Fixed routine operation is invalid." }, 400, true);
  }

  const target = await resolveOwnerWorkerDayPlanningTarget();
  if (!target) return privateJson({ ok: false, error: "Owner worker-day planning access is required." }, 403, true);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_command_fixed_routine_api_v1", {
    p_farm_id: target.farmId,
    p_membership_id: target.membershipId,
    p_command: body,
  });

  if (error) {
    const status = error.code === "42501" ? 403
      : error.code === "22023" ? 400
        : error.code === "55000" ? 409
          : 500;
    console.error("Atlas fixed routine command failed:", error);
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not update this repeating fixed time." : error.message }, status, true);
  }

  return privateJson({ ok: true, routineId, result: data }, 200, true);
}
