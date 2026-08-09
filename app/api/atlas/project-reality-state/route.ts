import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set(["finding_shape", "making_real", "closing_loop"]);

type Body = {
  projectId?: unknown;
  realityState?: unknown;
  reason?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "project-reality-state-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "Only Owner can change project reality state." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: error.message || "Project not found." }, 404);
  if (error.code === "22023" || error.code === "22P02" || error.code === "23514") return privateJson({ ok: false, error: error.message || "The reality-state change was rejected." }, 400);
  console.error("Project reality-state update failed.", error);
  return privateJson({ ok: false, error: "Project reality-state update failed." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Project reality-state changes require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess({ allowedRoles: ["owner"] });
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON project reality-state request is required." }, 400);
  }

  const projectId = clean(body.projectId);
  const realityState = clean(body.realityState);
  const reason = clean(body.reason) || null;

  if (!UUID_PATTERN.test(projectId)) return privateJson({ ok: false, error: "A valid project id is required." }, 400);
  if (!STATES.has(realityState)) return privateJson({ ok: false, error: "Choose Finding the shape, Making it real, or Closing the loop." }, 400);
  if (reason && reason.length > 1000) return privateJson({ ok: false, error: "Reality-state reason must be 1000 characters or fewer." }, 400);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("set_project_reality_state_v1", {
    p_project_id: projectId,
    p_reality_state: realityState,
    p_reason: reason,
  });
  if (error) return rpcFailure(error as RpcError);
  if (!data || typeof data !== "object" || Array.isArray(data)) return privateJson({ ok: false, error: "Atlas returned an invalid reality-state result." }, 500);

  return privateJson({ ...(data as Record<string, unknown>), ok: true });
}
