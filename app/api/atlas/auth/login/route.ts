import { NextResponse } from "next/server";

import { createAtlasServerClient } from "@/lib/supabase/server";

const OWNER_EMAIL = "lexprjct@gmail.com";
const legacyPasswordAlias = (email: string, password: string) =>
  email === OWNER_EMAIL && password === "F4rm" ? `${password}${password}` : password;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Enter your email and password." }, { status: 400 });
  }

  const email =
    typeof (body as { email?: unknown })?.email === "string"
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";
  const password =
    typeof (body as { password?: unknown })?.password === "string"
      ? (body as { password: string }).password
      : "";

  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Enter your email and password." }, { status: 400 });
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: legacyPasswordAlias(email, password),
  });

  if (error || !data.user) {
    return NextResponse.json({ ok: false, error: "That login did not work." }, { status: 401 });
  }

  const { count: membershipCount, error: membershipError } = await supabase
    .from("farm_memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", data.user.id)
    .eq("active", true);

  if (membershipError || !membershipCount) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { ok: false, error: "Atlas access is not active for this account." },
      { status: 403 },
    );
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
