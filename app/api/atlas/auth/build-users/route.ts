import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const BUILD_MARKER = "atlas-build-users-2026-07-20-v1";
const EXPECTED_KEY_DIGEST = "4f0d274e56988d8db1a7c90af30ccc78dd37f8bbc23f8423a20cc9c15b06da18";

const BUILD_USERS = [
  { email: "anna@elmfarm.co", displayName: "Anna" },
  { email: "marshall@elmfarm.co", displayName: "Marshall" },
] as const;

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

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listError) {
    return NextResponse.json({ ok: false, error: "User lookup failed." }, { status: 500 });
  }

  const existingByEmail = new Map(
    listed.users
      .filter((user) => user.email)
      .map((user) => [user.email!.toLowerCase(), user]),
  );

  if (
    BUILD_USERS.every(
      ({ email }) => existingByEmail.get(email)?.user_metadata?.build_users_marker === BUILD_MARKER,
    )
  ) {
    return NextResponse.json({ ok: false, error: "Build users already created." }, { status: 410 });
  }

  const created: Array<{ email: string; password: string; userId: string }> = [];

  for (const spec of BUILD_USERS) {
    const password = `${spec.displayName}-${randomBytes(6).toString("base64url")}!27`;
    const existing = existingByEmail.get(spec.email);

    if (existing) {
      const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...existing.user_metadata,
          display_name: spec.displayName,
          build_account: true,
          build_users_marker: BUILD_MARKER,
        },
      });

      if (error || !data.user) {
        return NextResponse.json(
          { ok: false, error: `Could not update ${spec.displayName}.` },
          { status: 500 },
        );
      }

      created.push({ email: spec.email, password, userId: data.user.id });
      continue;
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: spec.email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: spec.displayName,
        build_account: true,
        build_users_marker: BUILD_MARKER,
      },
    });

    if (error || !data.user) {
      return NextResponse.json(
        { ok: false, error: `Could not create ${spec.displayName}.` },
        { status: 500 },
      );
    }

    created.push({ email: spec.email, password, userId: data.user.id });
  }

  return NextResponse.json(
    { ok: true, users: created },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
