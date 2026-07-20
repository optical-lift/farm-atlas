import { NextResponse } from "next/server";
import { createAtlasAuthClient } from "@/lib/atlas-auth";

const OWNER_EMAIL = "lexprjct@gmail.com";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (email !== OWNER_EMAIL || password.length < 4) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = createAtlasAuthClient();
  const { data: users, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 2 });
  if (listError) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (users.users.length > 0) {
    return NextResponse.json({ ok: false, error: "Bootstrap closed." }, { status: 409 });
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Lex" },
  });
  if (createError || !created.user) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const { data: farm, error: farmError } = await supabase
    .from("farms")
    .select("id")
    .eq("stable_key", "elm_farm")
    .single();
  if (farmError || !farm) {
    await supabase.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const { error: profileError } = await supabase.from("user_profiles").insert({
    user_id: created.user.id,
    display_name: "Lex",
    default_farm_id: farm.id,
    active: true,
  });
  const { error: membershipError } = await supabase.from("farm_memberships").insert({
    user_id: created.user.id,
    farm_id: farm.id,
    role: "owner",
    worker_key: "lex",
    active: true,
    permissions: { all_farm_data: true, manage_memberships: true },
  });

  if (profileError || membershipError) {
    await supabase.from("farm_memberships").delete().eq("user_id", created.user.id);
    await supabase.from("user_profiles").delete().eq("user_id", created.user.id);
    await supabase.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
