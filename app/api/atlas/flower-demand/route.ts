import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BUYERS = {
  ruth: "ae9ed986-2ba6-43b3-b272-82fc09724d0f",
  lindas: "5872723e-e170-49d5-a7f0-f78b191a7a80",
} as const;
const FULFILLMENT_MODES = new Set(["pickup", "delivery", "immediate_handoff"]);
const SAMPLE_FORMS = new Set(["stem", "bundle", "posy", "bouquet", "arrangement"]);
const BUNDLE_SIZES = new Set([5, 10, 20]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type BuyerKey = keyof typeof BUYERS;
type RpcError = { code?: string; message?: string };
type Body = {
  sourceKey?: unknown;
  buyer?: unknown;
  requestedForDate?: unknown;
  fulfillmentMode?: unknown;
  sunflowerBundles?: unknown;
  sunflowerBundleSize?: unknown;
  samples?: unknown;
  sampleForm?: unknown;
  sampleBundleSize?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function whole(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function bundleSize(value: unknown) {
  const parsed = whole(value);
  return parsed !== null && BUNDLE_SIZES.has(parsed) ? parsed : null;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "flower-demand-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "Flower demand is outside the active account context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "Flower demand source was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The flower request was rejected." }, 400);
  console.error("Flower demand capture failed.", error);
  return privateJson({ ok: false, error: "Flower demand capture failed." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Flower demand requires a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm flower-demand scope." }, 403);
  }

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON flower request is required." }, 400);
  }

  const sourceKey = clean(body.sourceKey);
  const buyer = clean(body.buyer) as BuyerKey;
  const requestedForDate = clean(body.requestedForDate);
  const fulfillmentMode = clean(body.fulfillmentMode);
  const sunflowerBundles = whole(body.sunflowerBundles);
  const samples = whole(body.samples);
  const sunflowerBundleSize = bundleSize(body.sunflowerBundleSize);
  const sampleForm = clean(body.sampleForm);
  const sampleBundleSize = bundleSize(body.sampleBundleSize);

  if (!sourceKey || sourceKey.length > 160) return privateJson({ ok: false, error: "A valid flower-demand source key is required." }, 400);
  if (!(buyer in BUYERS)) return privateJson({ ok: false, error: "Choose a known buyer." }, 400);
  if (!ISO_DATE.test(requestedForDate) || Number.isNaN(Date.parse(`${requestedForDate}T12:00:00Z`))) {
    return privateJson({ ok: false, error: "Record the date the buyer needs the flowers." }, 400);
  }
  if (!FULFILLMENT_MODES.has(fulfillmentMode)) return privateJson({ ok: false, error: "Choose pickup, delivery, or immediate handoff." }, 400);
  if (sunflowerBundles === null || sunflowerBundles < 0 || samples === null || samples < 0 || sunflowerBundles + samples < 1) {
    return privateJson({ ok: false, error: "Record at least one requested item." }, 400);
  }
  if (sunflowerBundles > 0 && sunflowerBundleSize === null) {
    return privateJson({ ok: false, error: "Sunflower bundles must contain 5, 10, or 20 stems." }, 400);
  }
  if (samples > 0 && !SAMPLE_FORMS.has(sampleForm)) {
    return privateJson({ ok: false, error: "Record the physical form of the samples." }, 400);
  }
  if (samples > 0 && sampleForm === "bundle" && sampleBundleSize === null) {
    return privateJson({ ok: false, error: "Sample bundles must contain 5, 10, or 20 stems." }, 400);
  }

  const lines: Array<Record<string, unknown>> = [];
  if (sunflowerBundles > 0) {
    lines.push({
      inventoryKind: "bundle",
      productLabel: "Sunflower",
      quantity: sunflowerBundles,
      stemsPerUnit: sunflowerBundleSize,
    });
  }
  if (samples > 0) {
    lines.push({
      inventoryKind: sampleForm,
      productLabel: "Sample",
      quantity: samples,
      ...(sampleForm === "bundle" ? { stemsPerUnit: sampleBundleSize } : {}),
    });
  }

  const supabase = await createAtlasServerClient();
  const sharedArgs = {
    p_buyer_relationship_id: BUYERS[buyer],
    p_customer_label: null,
    p_demand_strength: "requested",
    p_sales_channel: "wholesale",
    p_requested_for_date: requestedForDate,
    p_fulfillment_mode: fulfillmentMode,
    p_fulfillment_due_time: null,
    p_lines: lines,
    p_note: null,
    p_idempotency_key: sourceKey,
  };

  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_flower_demand_order_v1", {
        p_effective_membership_id: operatorMembershipId,
        ...sharedArgs,
      })
    : await supabase.rpc("record_flower_demand_order_for_member_v1", {
        p_farm_id: authorized.access.membership.farmId,
        ...sharedArgs,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid flower-demand receipt." }, 500);
  }

  return privateJson({
    ok: true,
    demand: response.data,
    truthBoundary: "independent_demand",
    supplyClaimed: false,
    inventoryCommitted: false,
    saleRecorded: false,
    workerTimeScheduled: false,
    paymentStatus: "not_recorded",
    operatorMode: operatorContext?.isOperating ?? false,
  });
}
