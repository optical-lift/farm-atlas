import { NextResponse } from "next/server";

import { normalizeAtlasLoginCredentials } from "@/lib/atlas/auth-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Enter your email and password." }, { status: 400 });
  }

  const credentials = normalizeAtlasLoginCredentials(body);
  if (!credentials) {
    return NextResponse.json({ ok: false, error: "Enter your email and password." }, { status: 400 });
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(credentials);

  if (error || !data.user) {
    return NextResponse.json({ ok: false, error: "That login did not work." }, { status: 401 });
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
