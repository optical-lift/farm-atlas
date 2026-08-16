import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const intent = "principal-capacity-policy-v1";

function privateJson(body: Record<string, unknown>, status = 200, mutation = false) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      [mutation ? "X-Atlas-Mutation" : "X-Atlas-Read"]: mutation ? intent : "principal-capacity-policy-list-v1",
    },
  });
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function weekdayList(value: unknown) {
  if (!Array.isArray(value)) return null;
  const weekdays = Array.from(new Set(value.map(Number))).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return weekdays.length === value.length ? weekdays.sort((a, b) => a - b) : null;
}

function timeValue(value: unknown) {
  const candidate = text(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(candidate) ? candidate : "";
}

function dateValue(value: unknown, optional = false) {
  const candidate = text(value);
  if (optional && !candidate) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && !Number.isNaN(new Date(`${candidate}T12:00:00Z`).getTime())
    ? candidate
    : undefined;
}

function stableKeyFromName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || "principal_capacity";
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const supabase = await createAtlasServerClient();
  const principalRead = await supabase.rpc("current_principal_id_v1");
  if (principalRead.error) {
    const status = principalRead.error.code === "42501" ? 403 : 500;
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not resolve Principal context." : principalRead.error.message }, status);
  }
  if (!principalRead.data) return privateJson({ ok: true, state: "principal_required", policies: [] });

  const { data, error } = await supabase
    .from("principal_capacity_policies")
    .select("id,stable_key,name,weekdays,local_start,local_end,default_discretionary_minutes,maximum_planned_minutes,effective_from,effective_through,active,created_at,updated_at")
    .eq("principal_id", principalRead.data)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Principal capacity policy read failed:", error);
    return privateJson({ ok: false, error: "Atlas could not load Principal Capacity policies." }, 500);
  }

  return privateJson({ ok: true, state: "ready", policies: data ?? [] });
}

export async function POST(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401, true);
  if (request.headers.get("x-atlas-intent") !== intent) {
    return privateJson({ ok: false, error: "Explicit Principal Capacity intent is required." }, 409, true);
  }

  let body: Record<string, unknown>;
  try {
    body = objectBody(await request.json());
  } catch {
    return privateJson({ ok: false, error: "Capacity policy body must be valid JSON." }, 400, true);
  }

  const name = text(body.name);
  const weekdays = weekdayList(body.weekdays);
  const localStart = timeValue(body.localStart);
  const localEnd = timeValue(body.localEnd);
  const defaultDiscretionaryMinutes = integer(body.defaultDiscretionaryMinutes);
  const maximumPlannedMinutes = integer(body.maximumPlannedMinutes);
  const effectiveFrom = dateValue(body.effectiveFrom);
  const effectiveThrough = dateValue(body.effectiveThrough, true);

  if (!name) return privateJson({ ok: false, error: "A capacity policy name is required." }, 400, true);
  if (!weekdays?.length) return privateJson({ ok: false, error: "Choose at least one weekday." }, 400, true);
  if (!localStart || !localEnd || localEnd <= localStart) {
    return privateJson({ ok: false, error: "Choose a local end time after the local start time." }, 400, true);
  }
  if (defaultDiscretionaryMinutes === null || defaultDiscretionaryMinutes < 0) {
    return privateJson({ ok: false, error: "Discretionary minutes must be zero or greater." }, 400, true);
  }
  if (maximumPlannedMinutes === null || maximumPlannedMinutes < defaultDiscretionaryMinutes) {
    return privateJson({ ok: false, error: "Maximum planned minutes must be at least the discretionary minutes." }, 400, true);
  }
  if (!effectiveFrom) return privateJson({ ok: false, error: "An effective-from date is required." }, 400, true);
  if (effectiveThrough === undefined) return privateJson({ ok: false, error: "Effective-through must be a valid date or left blank." }, 400, true);
  if (effectiveThrough && effectiveThrough < effectiveFrom) {
    return privateJson({ ok: false, error: "Effective-through cannot be before effective-from." }, 400, true);
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("principal_set_capacity_policy_api_v1", {
    p_input: {
      stableKey: stableKeyFromName(name),
      name,
      weekdays,
      localStart,
      localEnd,
      defaultDiscretionaryMinutes,
      maximumPlannedMinutes,
      effectiveFrom,
      effectiveThrough,
      metadata: { authoredThrough: "principal_capacity_policy_ui_v1" },
    },
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : error.code === "23514" ? 400 : 500;
    console.error("Principal capacity policy write failed:", error);
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not save this Principal Capacity policy." : error.message }, status, true);
  }

  return privateJson({ ok: true, result: data }, 200, true);
}
