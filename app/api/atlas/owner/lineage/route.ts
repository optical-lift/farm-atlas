import { NextResponse } from "next/server";

import { readAtlasLineageAudit } from "@/lib/atlas/lineage-audit";
import { getAtlasSession } from "@/lib/atlas/session";
import { atlasPortalViewerFromSession } from "@/lib/atlas/viewer";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type LineageAction =
  | { action: "scan" }
  | { action: "review"; evidenceId?: string; decision?: "accept" | "reject"; note?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function ownerContext() {
  const session = await getAtlasSession();
  if (!session) return { error: privateJson({ ok: false, error: "Sign in required." }, 401) };

  const viewer = atlasPortalViewerFromSession(session);
  if (!viewer || !viewer.canManagePortfolio) {
    return { error: privateJson({ ok: false, error: "Owner Trail audit access is required." }, 403) };
  }

  return { viewer };
}

export async function GET() {
  const context = await ownerContext();
  if ("error" in context) return context.error;

  try {
    const audit = await readAtlasLineageAudit(context.viewer.organizationId);
    return privateJson({ ok: true, audit });
  } catch (error) {
    return privateJson({
      ok: false,
      error: error instanceof Error ? error.message : "Trail lineage audit could not be loaded.",
    }, 400);
  }
}

export async function POST(request: Request) {
  const context = await ownerContext();
  if ("error" in context) return context.error;

  let body: LineageAction;
  try {
    body = await request.json() as LineageAction;
  } catch {
    return privateJson({ ok: false, error: "A lineage audit action is required." }, 400);
  }

  const supabase = await createAtlasServerClient();
  let queued = 0;

  if (body.action === "scan") {
    const { data, error } = await supabase.rpc("queue_trail_lineage_candidates_v1", {
      p_organization_id: context.viewer.organizationId,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : 400;
      return privateJson({ ok: false, error: error.message || "Trail history scan failed." }, status);
    }
    queued = Number(data ?? 0);
  } else if (body.action === "review") {
    if (!body.evidenceId || (body.decision !== "accept" && body.decision !== "reject")) {
      return privateJson({ ok: false, error: "Choose one evidence candidate and a valid decision." }, 400);
    }

    const { error } = await supabase.rpc("review_trail_evidence_v1", {
      p_evidence_id: body.evidenceId,
      p_decision: body.decision,
      p_note: body.note?.trim() || null,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : 400;
      return privateJson({ ok: false, error: error.message || "Trail evidence review failed." }, status);
    }
  } else {
    return privateJson({ ok: false, error: "Unsupported lineage audit action." }, 400);
  }

  try {
    const audit = await readAtlasLineageAudit(context.viewer.organizationId);
    return privateJson({ ok: true, audit, queued });
  } catch (error) {
    return privateJson({
      ok: false,
      error: error instanceof Error ? error.message : "Trail lineage audit could not be refreshed.",
    }, 400);
  }
}
