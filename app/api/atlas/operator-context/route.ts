import { NextResponse } from "next/server";

import {
  ATLAS_OPERATOR_COOKIE,
  readAtlasOwnerOperatorContext,
  resolveAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET() {
  const context = await readAtlasOwnerOperatorContext();
  if (!context) return privateJson({ ok: false, error: "Owner operator mode is unavailable." }, 403);
  return privateJson({ ok: true, context });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ ok: false, error: "A JSON operator selection is required." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return privateJson({ ok: false, error: "A valid operator selection is required." }, 400);
  }

  const rawMembershipId = (body as { membershipId?: unknown }).membershipId;
  const membershipId = rawMembershipId === null || rawMembershipId === ""
    ? null
    : typeof rawMembershipId === "string" && UUID_PATTERN.test(rawMembershipId)
      ? rawMembershipId
      : undefined;

  if (membershipId === undefined) {
    return privateJson({ ok: false, error: "A valid Atlas membership is required." }, 400);
  }

  const context = await resolveAtlasOwnerOperatorContext(membershipId);
  if (!context) return privateJson({ ok: false, error: "This worker context is not available to the signed-in owner." }, 403);

  const response = privateJson({ ok: true, context });
  if (context.isOperating) {
    response.cookies.set(ATLAS_OPERATOR_COOKIE, context.effective.membershipId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    response.cookies.set(ATLAS_OPERATOR_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}
