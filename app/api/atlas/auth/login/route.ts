import { NextResponse } from "next/server";
import { createAtlasAuthClient, writeAtlasSession } from "@/lib/atlas-auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Enter your email and password." }, { status: 400 });
  }

  const email = typeof (body as { email?: unknown })?.email === "string"
    ? (body as { email: string }).email.trim().toLowerCase()
    : "";
  const password = typeof (body as { password?: unknown })?.password === "string"
    ? (body as { password: string }).password
    : "";

  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Enter your email and password." }, { status: 400 });
  }

  const supabase = createAtlasAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    return NextResponse.json({ ok: false, error: "That login did not work." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("active")
    .eq("user_id", data.user.id)
    .maybeSingle();

  const { count: membershipCount } = await supabase
    .from("farm_memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", data.user.id)
    .eq("active", true);

  if (!profile?.active || !membershipCount) {
    await supabase.auth.signOut();
    return NextResponse.json({ ok: false, error: "Atlas access is not active for this account." }, { status: 403 });
  }

  await writeAtlasSession(data.session.access_token, data.session.refresh_token);
  return NextResponse.json({ ok: true });
}
