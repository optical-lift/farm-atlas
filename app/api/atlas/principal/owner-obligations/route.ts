import { NextRequest, NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const intent = "principal-owner-obligation-v1";
const protectionLevels = new Set(["critical", "protected", "standard", "optional"]);
const ownerCapabilities = new Set(["think", "decide", "approve", "plan", "review", "create", "communicate", "fund"]);
const interruptibilityValues = new Set(["interruptible", "low_interruptibility", "should_not_interrupt"]);
const horizons = new Set(["H1", "H2", "H3"]);

function privateJson(body: Record<string, unknown>, status = 200, mutation = false) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      [mutation ? "X-Atlas-Mutation" : "X-Atlas-Read"]: mutation ? intent : "principal-owner-obligations-list-v1",
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

function stableKeyFromTitle(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
  return slug || "owner_obligation";
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

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

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function sameLocalParts(left: LocalParts, right: LocalParts) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute;
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

  return sameLocalParts(zonedParts(instant, timeZone), target)
    ? new Date(instant).toISOString()
    : undefined;
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const supabase = await createAtlasServerClient();
  const contextRead = await supabase.rpc("principal_self_context_api_v1");
  if (contextRead.error) {
    const status = contextRead.error.code === "42501" ? 403 : 500;
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not resolve Principal context." : contextRead.error.message }, status);
  }

  const context = objectBody(contextRead.data);
  const principal = objectBody(context.principal);
  const principalId = text(principal.id);
  if (!principalId) return privateJson({ ok: true, state: "principal_required", obligations: [], portfolioUnits: [] });

  const { data, error } = await supabase
    .from("owner_obligations")
    .select("id,stable_key,domain,portfolio_unit_id,title,description,horizon,becomes_relevant_at,must_begin_by,must_finish_by,fixed_at,expires_at,preferred_window,expected_minutes,protection_level,floor_class,owner_capability,interruptibility,delegable,owner_required,consequence_of_delay,reason_for_floor,status,source,created_at,updated_at,completed_at")
    .eq("principal_id", principalId)
    .order("status", { ascending: true })
    .order("must_begin_by", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Principal Owner Obligations read failed:", error);
    return privateJson({ ok: false, error: "Atlas could not load Owner Obligations." }, 500);
  }

  return privateJson({
    ok: true,
    state: "ready",
    homeTimezone: text(principal.homeTimezone) || "America/Chicago",
    obligations: data ?? [],
    portfolioUnits: Array.isArray(context.portfolioUnits) ? context.portfolioUnits : [],
  });
}

export async function POST(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401, true);
  if (request.headers.get("x-atlas-intent") !== intent) {
    return privateJson({ ok: false, error: "Explicit Owner Obligation intent is required." }, 409, true);
  }

  let body: Record<string, unknown>;
  try {
    body = objectBody(await request.json());
  } catch {
    return privateJson({ ok: false, error: "Owner Obligation body must be valid JSON." }, 400, true);
  }

  const domain = text(body.domain);
  const title = text(body.title);
  const description = text(body.description);
  const expectedMinutes = positiveInteger(body.expectedMinutes);
  const protectionLevel = text(body.protectionLevel);
  const floorClass = floorClassValue(body.floorClass);
  const ownerCapability = text(body.ownerCapability);
  const interruptibility = text(body.interruptibility);
  const consequenceOfDelay = text(body.consequenceOfDelay);
  const reasonForFloor = text(body.reasonForFloor);
  const horizon = text(body.horizon);
  const portfolioUnitStableKey = text(body.portfolioUnitStableKey);

  if (!domain) return privateJson({ ok: false, error: "An Owner Obligation domain is required." }, 400, true);
  if (!title) return privateJson({ ok: false, error: "An Owner Obligation title is required." }, 400, true);
  if (!expectedMinutes) return privateJson({ ok: false, error: "Expected Owner minutes must be a positive whole number." }, 400, true);
  if (!protectionLevels.has(protectionLevel)) return privateJson({ ok: false, error: "Choose a valid protection level." }, 400, true);
  if (!floorClass) return privateJson({ ok: false, error: "Choose a valid Principal Clock floor class." }, 400, true);
  if (!ownerCapabilities.has(ownerCapability)) return privateJson({ ok: false, error: "Choose the Owner capability this obligation requires." }, 400, true);
  if (!interruptibilityValues.has(interruptibility)) return privateJson({ ok: false, error: "Choose an interruptibility contract." }, 400, true);
  if (!consequenceOfDelay) return privateJson({ ok: false, error: "State the consequence of delay." }, 400, true);
  if (!reasonForFloor) return privateJson({ ok: false, error: "State why this responsibility may earn the Principal Clock floor." }, 400, true);
  if (horizon && !horizons.has(horizon)) return privateJson({ ok: false, error: "Horizon must be H1, H2, H3, or blank." }, 400, true);

  const supabase = await createAtlasServerClient();
  const contextRead = await supabase.rpc("principal_self_context_api_v1");
  if (contextRead.error) {
    const status = contextRead.error.code === "42501" ? 403 : 500;
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not resolve Principal context." : contextRead.error.message }, status, true);
  }
  const principal = objectBody(objectBody(contextRead.data).principal);
  const homeTimezone = text(principal.homeTimezone) || "America/Chicago";

  const becomesRelevantAt = principalLocalToIso(body.becomesRelevantAt, homeTimezone);
  const mustBeginBy = principalLocalToIso(body.mustBeginBy, homeTimezone);
  const mustFinishBy = principalLocalToIso(body.mustFinishBy, homeTimezone);
  const fixedAt = principalLocalToIso(body.fixedAt, homeTimezone);
  const expiresAt = principalLocalToIso(body.expiresAt, homeTimezone);
  const preferredWindowStart = principalLocalToIso(body.preferredWindowStart, homeTimezone);
  const preferredWindowEnd = principalLocalToIso(body.preferredWindowEnd, homeTimezone);

  const dateTimeEntries = [
    ["becomes relevant", becomesRelevantAt],
    ["must begin by", mustBeginBy],
    ["must finish by", mustFinishBy],
    ["fixed at", fixedAt],
    ["expires at", expiresAt],
    ["preferred window start", preferredWindowStart],
    ["preferred window end", preferredWindowEnd],
  ] as const;
  const invalidDateTime = dateTimeEntries.find(([, value]) => value === undefined);
  if (invalidDateTime) {
    return privateJson({ ok: false, error: `The ${invalidDateTime[0]} time is not valid in ${homeTimezone}.` }, 400, true);
  }
  if ((preferredWindowStart && !preferredWindowEnd) || (!preferredWindowStart && preferredWindowEnd)) {
    return privateJson({ ok: false, error: "Preferred window start and end must either both be supplied or both be blank." }, 400, true);
  }
  if (preferredWindowStart && preferredWindowEnd && preferredWindowEnd <= preferredWindowStart) {
    return privateJson({ ok: false, error: "Preferred window end must be after its start." }, 400, true);
  }
  if (mustBeginBy && mustFinishBy && mustFinishBy < mustBeginBy) {
    return privateJson({ ok: false, error: "Must-finish-by cannot be before must-begin-by." }, 400, true);
  }
  if (becomesRelevantAt && expiresAt && expiresAt < becomesRelevantAt) {
    return privateJson({ ok: false, error: "Expires-at cannot be before becomes-relevant-at." }, 400, true);
  }

  const { data, error } = await supabase.rpc("principal_upsert_owner_obligation_api_v1", {
    p_input: {
      stableKey: stableKeyFromTitle(title),
      domain,
      portfolioUnitStableKey: portfolioUnitStableKey || null,
      title,
      description: description || null,
      horizon: horizon || null,
      becomesRelevantAt,
      mustBeginBy,
      mustFinishBy,
      fixedAt,
      expiresAt,
      preferredWindowStart,
      preferredWindowEnd,
      expectedMinutes,
      protectionLevel,
      floorClass,
      ownerCapability,
      interruptibility,
      delegable: booleanValue(body.delegable),
      ownerRequired: true,
      consequenceOfDelay,
      reasonForFloor,
      status: "open",
      source: "principal_authoring_ui_v1",
      metadata: { authoredThrough: "principal_owner_obligation_ui_v1", homeTimezone },
    },
  });

  if (error) {
    const status = error.code === "42501" ? 403
      : error.code === "22023" || error.code === "23514" ? 400
        : error.code === "P0002" ? 404
          : 500;
    console.error("Principal Owner Obligation write failed:", error);
    return privateJson({ ok: false, error: status === 500 ? "Atlas could not save this Owner Obligation." : error.message }, status, true);
  }

  return privateJson({ ok: true, result: data }, 200, true);
}
