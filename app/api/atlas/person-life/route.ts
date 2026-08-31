import { NextResponse } from "next/server";

import { normalizePersonLifeCaptureInput } from "@/lib/atlas/person-life-capture-core.js";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

type CareCurrentStateRow = {
  subject_domain: string;
  subject_kind: string;
  subject_id: string;
  condition_state: string;
  disposition: string;
  last_observed_at: string;
  metadata: Record<string, unknown> | null;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "person-life-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return privateJson({ ok: false, error: "Sign in required." }, 401);
  }
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") {
    return privateJson(
      { ok: false, error: "Person-owned Life Intelligence is not live in this database yet.", code: "person_life_not_live" },
      503,
    );
  }
  console.error("Atlas person-life RPC failed:", error);
  return privateJson({ ok: false, error: "Atlas could not update person-owned life state." }, 500);
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const supabase = await createAtlasServerClient();
  const [lifeRead, conditionRead] = await Promise.all([
    supabase.rpc("person_life_state_api_v1"),
    supabase
      .from("care_current_state")
      .select("subject_domain, subject_kind, subject_id, condition_state, disposition, last_observed_at, metadata")
      .eq("scope_kind", "person")
      .eq("scope_id", session.userId)
      .order("last_observed_at", { ascending: false })
      .limit(50),
  ]);

  if (lifeRead.error) return rpcFailure(lifeRead.error as RpcError);
  if (conditionRead.error) {
    console.error("Atlas person condition read failed:", conditionRead.error);
    return privateJson({ ok: false, error: "Atlas could not read person condition state." }, 500);
  }

  return privateJson({
    ok: true,
    personLife: lifeRead.data ?? null,
    conditions: (conditionRead.data ?? []) as CareCurrentStateRow[],
  });
}

export async function POST(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ ok: false, error: "Capture payload must be valid JSON." }, 400);
  }

  const normalized = normalizePersonLifeCaptureInput(body, session.userId);
  if (!normalized.ok || !normalized.value) {
    return privateJson({ ok: false, error: normalized.error ?? "Invalid person-life capture." }, 400);
  }

  const supabase = await createAtlasServerClient();
  const action = (body as { action?: unknown }).action;

  if (action === "goal") {
    const { data, error } = await supabase.rpc("create_person_life_definition_api_v1", {
      p_payload: normalized.value,
    });
    if (error) return rpcFailure(error as RpcError);
    return privateJson({ ok: true, action: "goal", result: data });
  }

  if (action === "condition_observation") {
    const { data, error } = await supabase.rpc("record_person_condition_observation_api_v1", {
      p_payload: normalized.value,
    });
    if (error) return rpcFailure(error as RpcError);
    return privateJson({ ok: true, action: "condition_observation", result: data });
  }

  return privateJson({ ok: false, error: "Unsupported person-life capture type." }, 400);
}
