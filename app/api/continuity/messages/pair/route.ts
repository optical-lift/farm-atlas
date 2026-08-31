import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { createAtlasServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function safeText(value: unknown, fallback: string, max = 120) {
  if (typeof value !== "string") return fallback;
  const text = value.trim().slice(0, max);
  return text || fallback;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin rejected." }, 403);

  const supabase = await createAtlasServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return json({ ok: false, error: "Atlas sign-in required." }, 401);

  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    // Pairing has safe defaults and does not require a request body.
  }

  const input = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const providerAccountKey = safeText(input.providerAccountKey, "local_apple_messages_fixture", 180);
  const displayLabel = safeText(input.displayLabel, "This Mac · Apple Messages", 160);

  const relayToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(relayToken).digest("hex");

  const { data, error } = await supabase.rpc("register_communication_relay_api_v1", {
    p_provider_key: "apple_messages",
    p_provider_account_key: providerAccountKey,
    p_display_label: displayLabel,
    p_token_hash: tokenHash,
  });

  if (error) {
    if (error.code === "42883") {
      return json({ ok: false, error: "Atlas Continuity custody is not released to the database yet." }, 503);
    }
    console.error("Messages relay pairing failed", { code: error.code });
    return json({ ok: false, error: "Messages relay pairing failed." }, 500);
  }

  return json({
    ok: true,
    pairing: data,
    relayToken,
    ingestUrl: new URL("/api/continuity/messages/ingest", request.url).toString(),
    providerAccountKey,
    displayLabel,
    tokenShownOnce: true,
    governingStateChanged: false,
  });
}
