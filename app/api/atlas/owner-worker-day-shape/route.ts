import { NextRequest, NextResponse } from "next/server";
import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { resolveOwnerWorkerDayPlanningTarget } from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function validDateIso(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()); }
function validLocalTime(value: unknown): value is string { return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validWeekdays(value: unknown): value is number[] { if (!Array.isArray(value) || !value.length) return false; const normalized = value.map(Number); return normalized.every((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) && new Set(normalized).size === normalized.length; }
function privateJson(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Atlas-Mutation": "owner-worker-day-shape-v1" } }); }

export async function POST(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  if (request.headers.get("x-atlas-intent") !== "owner-worker-day-shape-v1") return privateJson({ ok: false, error: "Explicit Worker Day shape intent is required." }, 409);
  let body: Record<string, unknown>;
  try { const parsed = await request.json(); body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return privateJson({ ok: false, error: "Worker Day shape body must be valid JSON." }, 400); }
  const date = body.date, weekdays = body.weekdays, localStart = body.localStart, localEnd = body.localEnd;
  if (!validDateIso(date)) return privateJson({ ok: false, error: "date must be YYYY-MM-DD." }, 400);
  if (!validWeekdays(weekdays)) return privateJson({ ok: false, error: "Choose one or more unique weekdays." }, 400);
  if (!validLocalTime(localStart) || !validLocalTime(localEnd)) return privateJson({ ok: false, error: "Worker Day start and end must be HH:MM." }, 400);
  if (localEnd <= localStart) return privateJson({ ok: false, error: "Worker Day end must be later than its start." }, 400);
  const target = await resolveOwnerWorkerDayPlanningTarget();
  if (!target) return privateJson({ ok: false, error: "Owner worker-day planning access is required." }, 403);
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_set_worker_day_shape_api_v1", { p_farm_id: target.farmId, p_membership_id: target.membershipId, p_weekdays: weekdays, p_local_start: localStart, p_local_end: localEnd, p_effective_from: date, p_reason: "Owner-authored from Atlas Clock" });
  if (error) { const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500; console.error("Atlas Worker Day shape update failed:", error); return privateJson({ ok: false, error: status === 500 ? "Atlas could not update the Worker Day shape." : error.message }, status); }
  return privateJson({ ok: true, date, result: data });
}
