import { NextResponse } from "next/server";

import {
  ELM_WORK_SESSION_COOKIE,
  redeemElmWorkPass,
} from "@/lib/worker-work-pass";

export const dynamic = "force-dynamic";

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");

  if (origin && origin !== requestUrl.origin) {
    return noStoreJson({ ok: false, code: "origin_mismatch" }, 403);
  }

  let body: { pass?: string };
  try {
    body = (await request.json()) as { pass?: string };
  } catch {
    return noStoreJson({ ok: false, code: "invalid_json" }, 400);
  }

  const pass = body.pass?.trim() ?? "";
  if (!pass || pass.length > 512) {
    return noStoreJson({ ok: false, code: "invalid_pass" }, 400);
  }

  const redeemed = await redeemElmWorkPass(pass);
  if (!redeemed) {
    return noStoreJson({ ok: false, code: "invalid_or_expired_pass" }, 401);
  }

  const response = noStoreJson({ ok: true, destination: redeemed.destination });
  response.cookies.set(ELM_WORK_SESSION_COOKIE, redeemed.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: redeemed.expiresAt,
  });
  response.cookies.set("anna_worker_day_pilot", redeemed.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: redeemed.expiresAt,
  });

  return response;
}
