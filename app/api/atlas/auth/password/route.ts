import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const session = await getAtlasSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Enter the new password twice." }, { status: 400 });
  }

  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const password = typeof (source as { password?: unknown }).password === "string"
    ? (source as { password: string }).password
    : "";
  const confirmation = typeof (source as { confirmation?: unknown }).confirmation === "string"
    ? (source as { confirmation: string }).confirmation
    : "";

  if (password.length < 12) {
    return NextResponse.json(
      { ok: false, error: "Use at least 12 characters." },
      { status: 400 },
    );
  }

  if (password !== confirmation) {
    return NextResponse.json(
      { ok: false, error: "The passwords do not match." },
      { status: 400 },
    );
  }

  const supabase = await createAtlasServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Atlas could not change the password for this session." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
