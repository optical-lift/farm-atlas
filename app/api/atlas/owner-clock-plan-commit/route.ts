import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";
import { resolveOwnerWorkerDayPlanningTarget } from "@/lib/atlas/worker-day-plan-server";

export const dynamic = "force-dynamic";

const warningCodes = new Set(["outside_day", "fixed_time", "window", "anchor", "overlap", "reservation"]);
function validDateIso(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()); }
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function localTime(value: unknown): value is string | null { return value === null || (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)); }
function nullableIso(value: unknown): value is string | null { return value === null || (typeof value === "string" && !Number.isNaN(new Date(value).getTime())); }
function nullableDuration(value: unknown): value is number | null { return value === null || (Number.isInteger(value) && Number(value) >= 5 && Number(value) <= 720); }
function privateJson(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Atlas-Mutation": "owner-clock-plan-commit-v1" } }); }

function validChange(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!uuid(row.taskId)) return false;
  if (typeof row.setStart !== "boolean" || typeof row.setDuration !== "boolean") return false;
  if (!localTime(row.startLocalTime) || !nullableDuration(row.durationMinutes)) return false;
  if (!nullableIso(row.expectedStartAt) || !nullableDuration(row.expectedDurationMinutes)) return false;
  if (row.source !== "proposal" && row.source !== "committed") return false;
  if (typeof row.overrideWarnings !== "boolean") return false;
  if (!Array.isArray(row.warningCodes) || row.warningCodes.some((code) => typeof code !== "string" || !warningCodes.has(code))) return false;
  if (!row.setStart && !row.setDuration) return false;
  if (row.setStart && row.startLocalTime === null && row.durationMinutes !== null) return false;
  return true;
}

export async function POST(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  if (request.headers.get("x-atlas-intent") !== "owner-clock-plan-commit-v1") return privateJson({ ok:false, error:"Explicit Clock plan commit intent is required." }, 409);

  let body: Record<string, unknown>;
  try { const parsed = await request.json(); body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return privateJson({ ok:false, error:"Clock plan body must be valid JSON." }, 400); }

  if (!validDateIso(body.date)) return privateJson({ ok:false, error:"date must be YYYY-MM-DD." }, 400);
  if (!Array.isArray(body.changes) || body.changes.length < 1 || body.changes.length > 100 || body.changes.some((change) => !validChange(change))) return privateJson({ ok:false, error:"Clock plan changes are invalid." }, 400);
  const ids = body.changes.map((change) => (change as Record<string, unknown>).taskId as string);
  if (new Set(ids).size !== ids.length) return privateJson({ ok:false, error:"A task can appear only once in a Clock plan commit." }, 400);
  for (const change of body.changes as Array<Record<string, unknown>>) {
    if ((change.warningCodes as string[]).length && change.overrideWarnings !== true) return privateJson({ ok:false, error:"Timing warnings must be explicitly overridden before commit." }, 409);
  }

  const target = await resolveOwnerWorkerDayPlanningTarget();
  if (!target) return privateJson({ ok:false, error:"Owner worker-day planning access is required." }, 403);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_commit_worker_clock_plan_api_v1", {
    p_farm_id: target.farmId,
    p_membership_id: target.membershipId,
    p_day: body.date,
    p_changes: body.changes,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : error.code === "55000" ? 409 : 500;
    console.error("Atlas Clock plan commit failed:", error);
    return privateJson({ ok:false, error: status === 500 ? "Atlas could not commit this Clock plan." : error.message }, status);
  }
  return privateJson({ ok:true, date:body.date, result:data });
}
