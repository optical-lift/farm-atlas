import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { createAtlasAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_EVENTS = 1000;
const MAX_CONTENT_LENGTH = 8 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  if (token.length < 32 || token.length > 256) return null;
  return token;
}

export async function POST(request: Request) {
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_CONTENT_LENGTH) {
    return json({ ok: false, error: "Communication batch is too large." }, 413);
  }

  const token = bearerToken(request);
  if (!token) return json({ ok: false, error: "Relay credential required." }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid communication batch." }, 400);
  }

  const input = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const events = Array.isArray(input.events) ? input.events : null;
  const manifest = input.manifest && typeof input.manifest === "object" ? input.manifest : {};

  if (!events || events.length < 1 || events.length > MAX_EVENTS) {
    return json({ ok: false, error: `Relay batches must contain 1-${MAX_EVENTS} events.` }, 400);
  }

  const violatesEvidenceBoundary = events.some((event) => {
    if (!event || typeof event !== "object") return true;
    const record = event as Record<string, unknown>;
    return record.sourceAuthority !== "evidence_only"
      || record.permittedStateEffect !== "append_source_attributed_evidence_only"
      || record.governingStateChanged !== false;
  });
  if (violatesEvidenceBoundary) {
    return json({ ok: false, error: "Communication batch violates the evidence-only boundary." }, 400);
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = createAtlasAdminClient();
  const { data, error } = await admin.rpc("ingest_communication_events_relay_api_v1", {
    p_relay_token_hash: tokenHash,
    p_events: events,
    p_manifest: manifest,
  });

  if (error) {
    if (error.code === "28000") return json({ ok: false, error: "Relay credential is invalid or revoked." }, 401);
    if (error.code === "42501") return json({ ok: false, error: "Relay source custody rejected the batch." }, 403);
    if (error.code === "42883") return json({ ok: false, error: "Atlas Continuity custody is not released to the database yet." }, 503);
    console.error("Messages relay ingest failed", { code: error.code });
    return json({ ok: false, error: "Communication custody failed." }, 500);
  }

  return json({ ok: true, receipt: data });
}
