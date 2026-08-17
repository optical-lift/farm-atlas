import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody } from "@/lib/atlas/api-access";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CapacityAuthoringKind = "capacity_policy" | "household_rhythm";
type RpcError = { code?: string; message?: string };

const cadenceValues = new Set(["once", "daily", "weekly", "every_5_weeks"]);
const protectionValues = new Set(["critical", "protected", "standard", "optional"]);
const interruptibilityValues = new Set(["interruptible", "low_interruptibility", "should_not_interrupt"]);

function nonBlank(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function positiveInteger(value: unknown) {
  const number = integer(value);
  return number !== null && number > 0 ? number : null;
}

function nonNegativeInteger(value: unknown) {
  const number = integer(value);
  return number !== null && number >= 0 ? number : null;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "principal-capacity";
}

function localTimeMinutes(value: string | null) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function isoDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isoTimestamp(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function requirePrincipalOwner() {
  const session = await getAtlasSession();
  if (!session) {
    return { ok: false as const, response: atlasApiError(401, "sign_in_required", "Sign in required.") };
  }
  if (!session.organizationMemberships.some((membership) => membership.role === "owner")) {
    return {
      ok: false as const,
      response: atlasApiError(403, "principal_owner_required", "Principal owner access is required."),
    };
  }
  return { ok: true as const };
}

function normalizeCapacityPolicy(input: Record<string, unknown>) {
  const name = nonBlank(input.name);
  const localStart = nonBlank(input.localStart);
  const localEnd = nonBlank(input.localEnd);
  const startMinutes = localTimeMinutes(localStart);
  const endMinutes = localTimeMinutes(localEnd);
  const defaultDiscretionaryMinutes = nonNegativeInteger(input.defaultDiscretionaryMinutes);
  const maximumPlannedMinutes = nonNegativeInteger(input.maximumPlannedMinutes);
  const effectiveFrom = isoDate(nonBlank(input.effectiveFrom));
  const effectiveThrough = isoDate(nonBlank(input.effectiveThrough));
  const rawWeekdays = Array.isArray(input.weekdays) ? input.weekdays : [];
  const weekdays = [...new Set(rawWeekdays.map(integer).filter((value): value is number => value !== null))].sort((a, b) => a - b);

  if (!name || startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
    throw new Error("Capacity policy needs a name and a valid local start/end window.");
  }
  if (!weekdays.length || weekdays.some((day) => day < 0 || day > 6)) {
    throw new Error("Choose at least one valid weekday for Principal capacity.");
  }
  if (defaultDiscretionaryMinutes === null || maximumPlannedMinutes === null) {
    throw new Error("Discretionary and maximum planned minutes must be zero or greater.");
  }
  if (defaultDiscretionaryMinutes > maximumPlannedMinutes) {
    throw new Error("Discretionary capacity cannot exceed the maximum planned minutes.");
  }
  const windowMinutes = endMinutes - startMinutes;
  if (maximumPlannedMinutes > windowMinutes) {
    throw new Error("Maximum planned minutes cannot exceed the local capacity window itself.");
  }
  if (!effectiveFrom) {
    throw new Error("Choose the date this capacity policy becomes effective.");
  }
  if (nonBlank(input.effectiveThrough) && !effectiveThrough) {
    throw new Error("Effective-through date is invalid.");
  }
  if (effectiveThrough && effectiveThrough < effectiveFrom) {
    throw new Error("Effective-through cannot be earlier than effective-from.");
  }

  return {
    stableKey: nonBlank(input.stableKey) ?? slug(name),
    name,
    weekdays,
    localStart,
    localEnd,
    defaultDiscretionaryMinutes,
    maximumPlannedMinutes,
    effectiveFrom,
    effectiveThrough,
    metadata: { authoredFrom: "/principal/author/capacity" },
  };
}

function normalizeHouseholdRhythm(input: Record<string, unknown>) {
  const title = nonBlank(input.title);
  const area = nonBlank(input.area);
  const cadenceRule = nonBlank(input.cadenceRule);
  const nextWindowStart = isoTimestamp(nonBlank(input.nextWindowStart));
  const nextWindowEnd = isoTimestamp(nonBlank(input.nextWindowEnd));
  const expectedMinutes = positiveInteger(input.expectedMinutes);
  const protectionLevel = nonBlank(input.protectionLevel);
  const floorClass = positiveInteger(input.floorClass);
  const interruptibility = nonBlank(input.interruptibility);
  const consequence = nonBlank(input.consequence);
  const reasonForFloor = nonBlank(input.reasonForFloor);

  if (!title || !area || !cadenceRule || !cadenceValues.has(cadenceRule)) {
    throw new Error("Household rhythm needs a title, area, and supported cadence.");
  }
  if (!nextWindowStart || !nextWindowEnd || new Date(nextWindowEnd) <= new Date(nextWindowStart)) {
    throw new Error("Choose a valid first household window with an end after its start.");
  }
  if (!expectedMinutes) {
    throw new Error("Expected household minutes must be greater than zero.");
  }
  if (!protectionLevel || !protectionValues.has(protectionLevel)) {
    throw new Error("Choose a valid household protection level.");
  }
  if (!floorClass || floorClass > 7) {
    throw new Error("Household floor class must be between 1 and 7.");
  }
  if (!interruptibility || !interruptibilityValues.has(interruptibility)) {
    throw new Error("Choose a valid interruptibility state.");
  }
  if (!consequence || !reasonForFloor) {
    throw new Error("State both the consequence of neglect and why this rhythm may earn the Principal floor.");
  }

  return {
    stableKey: nonBlank(input.stableKey) ?? slug(`${area}-${title}`),
    area,
    title,
    cadenceRule,
    nextWindowStart,
    nextWindowEnd,
    expectedMinutes,
    protectionLevel,
    floorClass,
    interruptibility,
    principalRequired: true,
    consequence,
    reasonForFloor,
    active: true,
    blocksCapacity: input.blocksCapacity !== false,
    metadata: {
      authoredFrom: "/principal/author/capacity",
      cadenceExecution: cadenceRule === "once" ? "one_time" : "household_rhythm_tick_v1",
    },
  };
}

export async function POST(request: Request) {
  const authorized = await requirePrincipalOwner();
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch (error) {
    return atlasApiError(400, "invalid_request", error instanceof Error ? error.message : "Invalid request.");
  }

  const kind = nonBlank(body.kind) as CapacityAuthoringKind | null;
  const input = body.input;
  if ((kind !== "capacity_policy" && kind !== "household_rhythm") || !input || typeof input !== "object" || Array.isArray(input)) {
    return atlasApiError(400, "invalid_capacity_authoring_input", "A supported capacity authoring kind and input object are required.");
  }

  try {
    const supabase = await createAtlasServerClient();
    const normalized = kind === "capacity_policy"
      ? normalizeCapacityPolicy(input as Record<string, unknown>)
      : normalizeHouseholdRhythm(input as Record<string, unknown>);
    const rpc = kind === "capacity_policy"
      ? "principal_set_capacity_policy_api_v1"
      : "principal_upsert_household_rhythm_api_v1";
    const { data, error } = await supabase.rpc(rpc, { p_input: normalized });
    if (error) throw error;

    return NextResponse.json(
      { ok: true, kind, result: data },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Atlas-Write-Path": "principal-capacity-authoring-v1",
        },
      },
    );
  } catch (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return atlasApiError(403, "principal_context_required", "An active Principal household is required.");
    }
    if (rpcError.code === "22023" || rpcError.code === "23514" || error instanceof Error) {
      return atlasApiError(400, "principal_capacity_authoring_rejected", error instanceof Error ? error.message : rpcError.message ?? "Principal capacity authoring was rejected.");
    }
    console.error("Atlas Principal capacity authoring failed:", error);
    return atlasApiError(500, "principal_capacity_authoring_failed", "Atlas could not save this Principal capacity record.");
  }
}
