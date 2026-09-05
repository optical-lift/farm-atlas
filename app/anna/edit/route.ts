import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import {
  ANNA_WORKER_DAY_PILOT_COOKIE,
  hashAnnaPilotToken,
} from "@/lib/anna-worker-day-pilot";
import { ANNA_FARM_MEMBERSHIP_ID } from "@/lib/worker-delivery";
import { createAtlasAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type RedeemResult = {
  ok?: boolean;
  membershipId?: string;
  expiresAt?: string;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cleanUrl = new URL("/anna", requestUrl);
  const response = NextResponse.redirect(cleanUrl, 303);
  const bootstrapToken = requestUrl.searchParams.get("token")?.trim();

  if (!bootstrapToken) {
    return response;
  }

  const sessionToken = randomBytes(32).toString("base64url");
  const supabase = createAtlasAdminClient();
  const { data, error } = await supabase.rpc(
    "redeem_worker_delivery_pilot_capability_v1",
    {
      p_bootstrap_token_hash: hashAnnaPilotToken(bootstrapToken),
      p_session_token_hash: hashAnnaPilotToken(sessionToken),
    },
  );

  if (error) {
    console.error("Anna Worker Day pilot capability redemption failed:", error);
    return response;
  }

  const result = (data ?? {}) as RedeemResult;
  if (
    result.ok !== true ||
    result.membershipId !== ANNA_FARM_MEMBERSHIP_ID ||
    !result.expiresAt
  ) {
    return response;
  }

  response.cookies.set(ANNA_WORKER_DAY_PILOT_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(result.expiresAt),
  });

  return response;
}
