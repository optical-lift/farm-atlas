import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const intent = "principal-household-rhythm-v1";
const protectionLevels = new Set(["critical", "protected", "standard", "optional"]);
const interruptibilityValues = new Set(["interruptible", "low_interruptibility", "should_not_interrupt"]);

function privateJson(body: Record<string, unknown>, status = 200, mutation = false) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      [mutation ? "X-Atlas-Mutation" : "X-Atlas-Read"]: mutation ? intent : "principal-household-rhythms-list-v1",
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

function positiveInteger(value: unknown) {
  const candidate = typeof value === "number" ? value : Number(text(value));
  return Number.isInteger(candidate) && candidate > 0 ? candidate : null;
}

function floorClassValue(value: unknown) {
  const candidate = typeof value === "number" ? value : Number(text(value));
  return Number.isInteger(candidate) && candidate >= 1 && candidate <= 7 ? candidate : null;
}

function booleanValue(value: unknown) {
  return value === true || value === "true";
}

function stableKeyFromTitle(area: string, title: string) {
  const slug = `${area}_${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return slug || "household_rhythm";
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function parseLocalDateTime(value: unknown): LocalParts | null {
  const candidate = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(candidate);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const parts = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute) };
  const stamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const check = new Date(stamp);
  return check.getUTCFullYear() === parts.year
    && check.getUTCMonth() + 1 === parts.month
    && check.getUTCDate() === parts.day
    && check.getUTCHours() === parts.hour
    && check.getUTCMinutes() === parts.minute
    ? parts
    : null;
}

function zonedParts(timestamp: number, timeZone: string): LocalParts {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute) };
}

function sameLocalParts(left: LocalParts, right: LocalParts) {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute;
}

function principalLocalToIso(value: unknown, timeZone: string) {
  const candidate = text(value);
  if (!candidate) return null;
  const target = parseLocalDateTime(candidate);
  if (!target) return undefined;
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  let instant = targetAsUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const represented = zonedParts(instant, timeZone);
    const representedAsUtc = Date.UTC(represented.year, represented.month - 1, represented.day, represented.hour, represented.minute);
    const difference = representedAsUtc - targetAsUtc;
    if (difference === 0) break;
    instant -= difference;
  }
  return sameLocalParts(zonedParts(instant, timeZone), target) ? new Date(instant).toISOString() : undefined;
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const supabase = await createAtlasServerClient();
  const contextRead = await supabase.rpc("principal_self_context_api_v1");
  if (contextRead.error) {
    const status = contextRead.error.code === "42501" ? 403 : 500;
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not resolve Principal household context." : contextRead.error.message }, status);
  }

  const context = objectBody(contextRead.data);
  const principal = objectBody(context.principal);
  const household = objectBody(context.household);
  const householdId = text(household.id);
  if (!householdId) return privateJson({ ok: true, state: "household_required", rhythms: [] });

  const { data, error } = await supabase
    .from("household_rhythms")
    .select("id,stable_key,area,title,cadence_rule,next_window_start,next_window_end,expected_minutes,protection_level,floor_class,interruptibility,principal_required,consequence,reason_for_floor,active,blocks_capacity,created_at,updated_at")
    .eq("household_id", householdId)
    .order("active", { ascending: false })
    .order("next_window_start", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Principal household rhythms read failed:", error);
    return privateJson({ ok: false, error: "Atlas could not load Household rhythms." }, 500);
  }

  return privateJson({
    ok: true,
    state: "ready",
    householdName: text(household.name) || "Household",
    homeTimezone: text(principal.homeTimezone) || text(household.timezone) || "America/Chicago",
    rhythms: data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401, true);
  if (request.headers.get("x-atlas-intent") !== intent) {
    return privateJson({ ok: false, error: "Explicit Household rhythm intent is required." }, 409, true);
  }

  let body: Record<string, unknown>;
  try {
    body = objectBody(await request.json());
  } catch {
    return privateJson({ ok: false, error: "Household rhythm body must be valid JSON." }, 400, true);
  }

  const area = text(body.area);
  const title = text(body.title);
  const cadenceRule = text(body.cadenceRule);
  const expectedMinutes = positiveInteger(body.expectedMinutes);
  const protectionLevel = text(body.protectionLevel);
  const floorClass = floorClassValue(body.floorClass);
  const interruptibility = text(body.interruptibility);
  const consequence = text(body.consequence);
  const reasonForFloor = text(body.reasonForFloor);

  if (!area) return privateJson({ ok: false, error: "A household area is required." }, 400, true);
  if (!title) return privateJson({ ok: false, error: "A household rhythm title is required." }, 400, true);
  if (!expectedMinutes) return privateJson({ ok: false, error: "Expected minutes must be a positive whole number." }, 400, true);
  if (!protectionLevels.has(protectionLevel)) return privateJson({ ok: false, error: "Choose a valid protection level." }, 400, true);
  if (!floorClass) return privateJson({ ok: false, error: "Choose a valid Principal Clock floor class." }, 400, true);
  if (!interruptibilityValues.has(interruptibility)) return privateJson({ ok: false, error: "Choose an interruptibility contract." }, 400, true);
  if (!reasonForFloor) return privateJson({ ok: false, error: "State why this household rhythm has the selected floor class." }, 400, true);

  const supabase = await createAtlasServerClient();
  const contextRead = await supabase.rpc("principal_self_context_api_v1");
  if (contextRead.error) {
    const status = contextRead.error.code === "42501" ? 403 : 500;
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not resolve Principal household context." : contextRead.error.message }, status, true);
  }
  const context = objectBody(contextRead.data);
  const principal = objectBody(context.principal);
  const household = objectBody(context.household);
  const homeTimezone = text(principal.homeTimezone) || text(household.timezone) || "America/Chicago";

  const nextWindowStart = principalLocalToIso(body.nextWindowStart, homeTimezone);
  const nextWindowEnd = principalLocalToIso(body.nextWindowEnd, homeTimezone);
  if (nextWindowStart === undefined || nextWindowEnd === undefined) {
    return privateJson({ ok: false, error: `The next Household window is not valid in ${homeTimezone}.` }, 400, true);
  }
  if ((nextWindowStart && !nextWindowEnd) || (!nextWindowStart && nextWindowEnd)) {
    return privateJson({ ok: false, error: "Next window start and end must either both be supplied or both be blank." }, 400, true);
  }
  if (nextWindowStart && nextWindowEnd && nextWindowEnd <= nextWindowStart) {
    return privateJson({ ok: false, error: "Next Household window end must be after its start." }, 400, true);
  }

  const principalRequired = booleanValue(body.principalRequired);
  const blocksCapacity = booleanValue(body.blocksCapacity);

  const { data, error } = await supabase.rpc("principal_upsert_household_rhythm_api_v1", {
    p_input: {
      stableKey: stableKeyFromTitle(area, title),
      area,
      title,
      cadenceRule: cadenceRule || null,
      nextWindowStart,
      nextWindowEnd,
      expectedMinutes,
      protectionLevel,
      floorClass,
      interruptibility,
      principalRequired,
      consequence: consequence || null,
      reasonForFloor,
      active: true,
      blocksCapacity,
      metadata: { authoredThrough: "principal_household_rhythm_ui_v1", homeTimezone },
    },
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "22023" || error.code === "23514" ? 400 : 500;
    console.error("Principal Household rhythm write failed:", error);
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not save this Household rhythm." : error.message }, status, true);
  }

  return privateJson({ ok: true, result: data }, 200, true);
}
