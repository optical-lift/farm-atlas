import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KINDS = new Set(["foraged", "purchased", "gifted"]);
const COUNT_UNITS = new Set(["stem", "bucket", "bundle"]);

type RpcError = { code?: string; message?: string };
type IntakeLineBody = {
  flowerLabel?: unknown;
  colorLabel?: unknown;
  countUnit?: unknown;
  quantity?: unknown;
};
type Body = {
  taskId?: unknown;
  sourceKind?: unknown;
  sourceLabel?: unknown;
  lines?: unknown;
  idempotencyKey?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function wholeNumber(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "external-flower-intake-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "External flower intake is outside the active Harvest context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Weekly Harvest task was not found." }, 404);
  if (error.code === "23505") return privateJson({ ok: false, error: error.message || "This external intake was already recorded differently." }, 409);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The external flower intake was rejected." }, 400);
  console.error("External flower intake failed.", error);
  return privateJson({ ok: false, error: "External flower intake failed." }, 500);
}

async function requestContext() {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return { authorized, operatorContext: null, operatorMembershipId: null };
  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  return { authorized, operatorContext, operatorMembershipId };
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "External flower intake requires a same-origin Atlas request." }, 403);
  }

  const { authorized, operatorContext, operatorMembershipId } = await requestContext();
  if (!authorized.ok) return authorized.response;
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm Harvest scope." }, 403);
  }

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON external flower intake is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const sourceKind = clean(body.sourceKind).toLowerCase();
  const sourceLabel = clean(body.sourceLabel);
  const idempotencyKey = clean(body.idempotencyKey);

  if (!UUID_PATTERN.test(taskId)) {
    return privateJson({ ok: false, error: "A valid Weekly Harvest task is required." }, 400);
  }
  if (!SOURCE_KINDS.has(sourceKind)) {
    return privateJson({ ok: false, error: "Choose Foraged, Purchased, or Gifted." }, 400);
  }
  if (!sourceLabel || sourceLabel.length > 200) {
    return privateJson({ ok: false, error: "Source / place is required and must be 200 characters or fewer." }, 400);
  }
  if (!idempotencyKey || idempotencyKey.length > 160) {
    return privateJson({ ok: false, error: "A valid external intake idempotency key is required." }, 400);
  }
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 24) {
    return privateJson({ ok: false, error: "Add between 1 and 24 flowers to the external intake." }, 400);
  }

  const lines: Array<{ flowerLabel: string; colorLabel: string; countUnit: string; quantity: number }> = [];
  for (const rawLine of body.lines) {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) {
      return privateJson({ ok: false, error: "Every external intake row must be a flower row." }, 400);
    }

    const line = rawLine as IntakeLineBody;
    const flowerLabel = clean(line.flowerLabel);
    const colorLabel = clean(line.colorLabel);
    const countUnit = clean(line.countUnit).toLowerCase();
    const quantity = wholeNumber(line.quantity);

    if (!flowerLabel || flowerLabel.length > 160) {
      return privateJson({ ok: false, error: "Each row needs a flower name of 160 characters or fewer." }, 400);
    }
    if (["fq", "florist quality", "sp", "spent"].includes(flowerLabel.toLowerCase())) {
      return privateJson({ ok: false, error: "FQ/SP are condition labels, not flower identity. Record the flower name." }, 400);
    }
    if (!colorLabel || colorLabel.length > 160) {
      return privateJson({ ok: false, error: "Each row needs a color of 160 characters or fewer." }, 400);
    }
    if (!COUNT_UNITS.has(countUnit)) {
      return privateJson({ ok: false, error: "Count each row by stems, buckets, or bundles." }, 400);
    }
    if (quantity === null || quantity < 1 || quantity > 10000) {
      return privateJson({ ok: false, error: "Each external intake quantity must be a whole number between 1 and 10000." }, 400);
    }

    lines.push({ flowerLabel, colorLabel, countUnit, quantity });
  }

  const supabase = await createAtlasServerClient();
  const args = {
    p_task_id: taskId,
    p_source_kind: sourceKind,
    p_source_label: sourceLabel,
    p_lines: lines,
    p_idempotency_key: idempotencyKey,
  };

  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_external_flower_intake_v1", {
        p_effective_membership_id: operatorMembershipId,
        ...args,
      })
    : await supabase.rpc("record_external_flower_intake_for_member_v1", {
        p_farm_id: authorized.access.membership.farmId,
        ...args,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid external flower intake result." }, 500);
  }

  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
  });
}
