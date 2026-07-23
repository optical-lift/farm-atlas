import { NextResponse } from "next/server";

import { readAtlasJsonBody, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };
type PreparedObject = { objectId?: string };

const PRESSURES = new Set(["none", "light", "moderate", "heavy", "severe", "unknown"]);
const STRATEGIES = new Set([
  "active_hand_care",
  "targeted_recovery",
  "mow_and_hold",
  "suppressed_by_tarp",
  "mulch_hold",
  "cover_crop_hold",
  "resting_until_review",
  "redesign_pending",
  "removal_pending",
  "unknown",
]);

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

function validStableKey(value: string | null) {
  const key = value?.trim() ?? "";
  return /^[a-zA-Z0-9_-]{1,180}$/.test(key) ? key : null;
}

function nullableBoolean(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  throw new Error(`${label} must be yes, no, or unknown.`);
}

function nullableMinutes(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error("Estimated effort must be between 0 and 1,440 minutes.");
  }
  return Math.round(minutes);
}

function nullableText(value: unknown, maxLength: number) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Text fields must be text.");
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

async function readPreparedObject(
  supabase: Awaited<ReturnType<typeof createAtlasServerClient>>,
  farmId: string,
  objectKey: string,
) {
  return supabase.rpc("farm_care_object_v1", {
    p_farm_id: farmId,
    p_object_key: objectKey,
    p_history_limit: 20,
  });
}

function readFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: "Farm access is not active." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Atlas could not find this farm place." }, 404);
  console.error("Atlas Farm Care object read failed:", error);
  return privateJson({ ok: false, error: "Atlas could not load this farm place." }, 500);
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const objectKey = validStableKey(new URL(request.url).searchParams.get("objectKey"));
  if (!objectKey) return privateJson({ ok: false, error: "Choose a valid farm place." }, 400);

  const supabase = await createAtlasServerClient();
  const { data, error } = await readPreparedObject(
    supabase,
    authorized.access.membership.farmId,
    objectKey,
  );
  if (error) return readFailure(error as RpcError);

  return privateJson({
    ok: true,
    farmKey: authorized.access.membership.farmKey ?? "elm_farm",
    role: authorized.access.membership.role,
    object: data,
  });
}

export async function POST(request: Request) {
  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner", "manager"] });
  if (!authorized.ok) return authorized.response;

  const objectKey = validStableKey(new URL(request.url).searchParams.get("objectKey"));
  if (!objectKey) return privateJson({ ok: false, error: "Choose a valid farm place." }, 400);

  try {
    const body = await readAtlasJsonBody(request);
    const action = typeof body.action === "string" ? body.action : "";
    const supabase = await createAtlasServerClient();
    const initial = await readPreparedObject(
      supabase,
      authorized.access.membership.farmId,
      objectKey,
    );
    if (initial.error) return readFailure(initial.error as RpcError);

    const objectId = (initial.data as PreparedObject | null)?.objectId;
    if (!objectId) return privateJson({ ok: false, error: "Atlas could not resolve this farm place." }, 404);

    if (action === "observe") {
      const pressure = typeof body.pressure === "string" ? body.pressure : "";
      if (!PRESSURES.has(pressure)) throw new Error("Choose a valid pressure reading.");

      const { error } = await supabase.rpc("record_care_observation_v1", {
        p_object_id: objectId,
        p_pressure_band: pressure,
        p_intended_shape_readable: nullableBoolean(body.intendedShapeReadable, "Shape readability"),
        p_function_protected: nullableBoolean(body.functionProtected, "Protected function"),
        p_recovery_required: nullableBoolean(body.recoveryRequired, "Recovery requirement"),
        p_estimated_recovery_minutes: nullableMinutes(body.estimatedEffortMinutes),
        p_note: nullableText(body.note, 1200),
        p_metadata: { source: "farm_care_object_page" },
      });
      if (error) throw error;
    } else if (action === "strategy") {
      const strategy = typeof body.strategy === "string" ? body.strategy : "";
      if (!STRATEGIES.has(strategy)) throw new Error("Choose a valid care strategy.");
      const reviewOn = nullableText(body.reviewOn, 10);
      if (reviewOn && !/^\d{4}-\d{2}-\d{2}$/.test(reviewOn)) {
        throw new Error("Review date must use YYYY-MM-DD.");
      }

      const { error } = await supabase.rpc("set_object_care_strategy_v1", {
        p_object_id: objectId,
        p_strategy: strategy,
        p_review_on: reviewOn,
        p_reason: nullableText(body.reason, 1200),
        p_source: "farm_care_object_page",
      });
      if (error) throw error;
    } else {
      throw new Error("Choose a supported Farm Care update.");
    }

    const refreshed = await readPreparedObject(
      supabase,
      authorized.access.membership.farmId,
      objectKey,
    );
    if (refreshed.error) return readFailure(refreshed.error as RpcError);

    return privateJson({
      ok: true,
      role: authorized.access.membership.role,
      object: refreshed.data,
    });
  } catch (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "Manager or Owner access is required." }, 403);
    }
    const message = error instanceof Error ? error.message : "Farm Care update failed.";
    console.error("Atlas Farm Care object update failed:", error);
    return privateJson({ ok: false, error: message }, 400);
  }
}
