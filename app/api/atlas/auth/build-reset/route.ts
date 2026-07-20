import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const USER_ID = "4cd799e2-16d4-4020-9d21-ccf1a2b98553";
const RESET_MARKER = "atlas-build-password-reset-2026-07-20-v2";
const EXPECTED_KEY_DIGEST = "72267a571a0feb209e7cced5776bfd1248fb661d66232386c8007d8c8404c479";

function env(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function validKey(value: string | null) {
  if (!value) return false;
  const actual = Buffer.from(createHash("sha256").update(value).digest("hex"));
  const expected = Buffer.from(EXPECTED_KEY_DIGEST);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!validKey(key)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: current, error: readError } = await supabase.auth.admin.getUserById(USER_ID);
  if (readError || !current.user) {
    return NextResponse.json({ ok: false, error: "User lookup failed." }, { status: 500 });
  }

  if (current.user.app_metadata?.build_password_marker === RESET_MARKER) {
    return NextResponse.json({ ok: false, error: "Reset already used." }, { status: 410 });
  }

  const password = `ElmAtlas-${randomBytes(7).toString("base64url")}!27`;
  const { error: updateError } = await supabase.auth.admin.updateUserById(USER_ID, {
    password,
    app_metadata: {
      ...current.user.app_metadata,
      build_password_marker: RESET_MARKER,
    },
  });

  if (updateError) {
    return NextResponse.json({ ok: false, error: "Password reset failed." }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, password },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
