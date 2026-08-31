import { NextRequest, NextResponse } from "next/server";

import { normalizeOrganizationEstablishmentInput } from "@/lib/atlas/organization-onboarding-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Enter an organization name." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const normalized = normalizeOrganizationEstablishmentInput(body);
  if (!normalized.ok || !normalized.value) {
    return NextResponse.json(
      { ok: false, error: normalized.error ?? "Enter an organization name." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const supabase = await createAtlasServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { ok: false, error: "Sign in before adding an organization." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { data, error } = await supabase.rpc("establish_organization_self_api_v1", {
    p_name: normalized.value.name,
  });

  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    console.error("Atlas organization establishment failed", {
      code: error?.code ?? null,
      message: error?.message ?? null,
    });
    return NextResponse.json(
      { ok: false, error: "Atlas could not establish that organization." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, result: data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
