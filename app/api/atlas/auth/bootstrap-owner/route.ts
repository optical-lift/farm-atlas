import { NextResponse } from "next/server";
import { createAtlasAuthClient } from "@/lib/atlas-auth";

const OWNER_EMAIL = "lexprjct@gmail.com";
const temporaryStoredPassword = (password: string) => `${password}${password}`;

async function bootstrap(email: string, password: string) {
  if (email !== OWNER_EMAIL || password.length < 4) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = createAtlasAuthClient();
  const { data: users, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 2 });
  if (listError) return NextResponse.json({ ok: false, stage: "list" }, { status: 500 });
  if (users.users.length > 0) {
    return NextResponse.json({ ok: false, error: "Bootstrap closed." }, { status: 409 });
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: temporaryStoredPassword(password),
    email_confirm: true,
    user_metadata: { display_name: "Lex" },
  });
  if (createError || !created.user) {
    return NextResponse.json({ ok: false, stage: "create" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId: created.user.id });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return bootstrap(
    (url.searchParams.get("email") ?? "").trim().toLowerCase(),
    url.searchParams.get("password") ?? "",
  );
}

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  return bootstrap(body.email?.trim().toLowerCase() ?? "", body.password ?? "");
}
