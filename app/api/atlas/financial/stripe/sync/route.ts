import { NextRequest, NextResponse } from "next/server";

import {
  markStripeSourceSynced,
  readStripeSourceAccessToken,
  syncStripeFinancialSourcePage,
  type StripeFinancialListKind,
} from "@/lib/atlas/financial/stripe-server";
import { getAtlasSession, membershipForOrganization } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const KINDS: StripeFinancialListKind[] = [
  "balance_transaction",
  "charge",
  "refund",
  "payout",
  "invoice",
];

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) return json(401, { ok: false, error: "sign_in_required" });

  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    body = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind as StripeFinancialListKind : null;
  const startingAfter = typeof body.startingAfter === "string" && body.startingAfter.trim()
    ? body.startingAfter.trim()
    : null;
  if (!sourceId || !kind || !KINDS.includes(kind)) {
    return json(400, { ok: false, error: "source_and_supported_kind_required", supportedKinds: KINDS });
  }

  const supabase = await createAtlasServerClient();
  const { data: sources, error: sourceError } = await supabase.rpc("connected_sources_self_api_v1");
  if (sourceError) return json(500, { ok: false, error: "source_registry_unavailable" });
  const source = Array.isArray(sources)
    ? sources.find((row) => row?.source_id === sourceId && row?.provider_key === "stripe")
    : null;
  if (!source?.custodian_organization_id) return json(404, { ok: false, error: "stripe_source_not_found" });

  const membership = membershipForOrganization(session, source.custodian_organization_id);
  if (!membership || membership.role !== "owner") {
    return json(403, { ok: false, error: "organization_owner_required" });
  }
  if (source.authorization_state !== "connected") {
    return json(409, { ok: false, error: "stripe_source_not_connected", authorizationState: source.authorization_state });
  }
  if (source.capabilities?.financialObservation !== true) {
    return json(403, { ok: false, error: "financial_observation_capability_required" });
  }

  try {
    const accessToken = await readStripeSourceAccessToken(sourceId);
    const result = await syncStripeFinancialSourcePage({
      organizationId: source.custodian_organization_id,
      sourceId,
      accessToken,
      kind,
      startingAfter,
      limit: 100,
    });
    if (!result.hasMore && kind === "invoice") {
      // The UI/orchestrator walks kinds in canonical order. Completing the final
      // invoice page is the explicit full-pass boundary for last_sync_at.
      await markStripeSourceSynced(sourceId);
    }
    return json(200, {
      ok: true,
      sourceId,
      organizationId: source.custodian_organization_id,
      kind: result.kind,
      count: result.count,
      hasMore: result.hasMore,
      nextStartingAfter: result.nextStartingAfter,
      recorded: result.results.map((item) => ({
        observationId: item.observationId,
        providerRecordKind: item.normalized.providerRecordKind,
        providerRecordId: item.normalized.providerRecordId,
        economicEventIds: item.economicEventIds,
      })),
    });
  } catch (error) {
    return json(502, {
      ok: false,
      error: "stripe_sync_failed",
      detail: error instanceof Error ? error.message.slice(0, 240) : "unknown",
    });
  }
}
