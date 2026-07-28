import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { atlasUniversalViewerFromSession } from "@/lib/atlas/viewer";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const viewer = atlasUniversalViewerFromSession(session);
  if (!viewer) return privateJson({ ok: false, error: "Atlas membership is required." }, 403);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("universal_trail_pulse_v1", {
    p_organization_id: viewer.activeOrganizationId,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : 400;
    return privateJson({ ok: false, error: error.message || "Trail Pulse could not be loaded." }, status);
  }

  return privateJson({ ok: true, pulse: Array.isArray(data) ? data : [] });
}
