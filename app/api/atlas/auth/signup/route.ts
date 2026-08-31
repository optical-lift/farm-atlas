import { NextRequest, NextResponse } from "next/server";

import {
  humanSignupEnabled,
  normalizeHumanSignupInput,
} from "@/lib/atlas/account-bootstrap-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!humanSignupEnabled(process.env.ATLAS_HUMAN_SIGNUP_ENABLED)) {
    return NextResponse.json(
      { ok: false, error: "New Atlas accounts are not open yet." },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Enter your account details." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const normalized = normalizeHumanSignupInput(body);
  if (!normalized.ok || !normalized.value) {
    return NextResponse.json(
      { ok: false, error: normalized.error ?? "Enter your account details." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const publicOrigin = process.env.ATLAS_PUBLIC_ORIGIN ?? request.nextUrl.origin;
  const confirmationUrl = new URL("/auth/confirm", publicOrigin);
  confirmationUrl.searchParams.set("next", "/onboarding");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: normalized.value.email,
    password: normalized.value.password,
    options: {
      emailRedirectTo: confirmationUrl.toString(),
      data: {
        display_name: normalized.value.displayName,
        atlas_account_bootstrap: true,
      },
    },
  });

  if (error || !data.user) {
    return NextResponse.json(
      { ok: false, error: "Atlas could not create that account." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      confirmationRequired: !data.session,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
