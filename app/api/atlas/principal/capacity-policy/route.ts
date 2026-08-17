import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Read-Path": "principal-capacity-policy-v1",
    },
  });
}

async function requirePrincipalSession() {
  const session = await getAtlasSession();
  if (!session) return { error: privateJson({ ok: false, error: "Sign in required." }, 401) } as const;
  if (!session.organizationMemberships.some((membership) => membership.role === "owner")) {
    return { error: privateJson({ ok: false, error: "Principal access required." }, 403) } as const;
  }
  return { session } as const;
}

export async function GET() {
  const auth = await requirePrincipalSession();
  if ("error" in auth) return auth.error;

  try {
    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("principal_capacity_policies_self_api_v1");
    if (error) throw error;
    return privateJson({ ok: true, ...(data as Record<string, unknown>) });
  } catch (error) {
    console.error("Atlas Principal capacity policy read failed:", error);
    return privateJson({ ok: false, error: "Principal Capacity could not be loaded." }, 500);
  }
}

export async function POST(request: Request) {
  const auth = await requirePrincipalSession();
  if ("error" in auth) return auth.error;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return privateJson({ ok: false, error: "Capacity policy input must be valid JSON." }, 400);
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return privateJson({ ok: false, error: "Capacity policy input must be an object." }, 400);
  }

  try {
    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("principal_set_capacity_policy_api_v1", { p_input: input });
    if (error) {
      const validation = error.code === "22023";
      return privateJson({ ok: false, error: error.message }, validation ? 400 : 500);
    }
    return privateJson({ ok: true, ...(data as Record<string, unknown>) });
  } catch (error) {
    console.error("Atlas Principal capacity policy write failed:", error);
    return privateJson({ ok: false, error: "Principal Capacity could not be saved." }, 500);
  }
}
