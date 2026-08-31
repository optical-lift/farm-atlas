import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { atlasAuthConfirmationNext } from "@/lib/atlas/account-bootstrap-core.js";
import { isValidInviteId, safeInviteRedirect } from "@/lib/atlas/invite-flow-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const HUMAN_OTP_TYPES = new Set<EmailOtpType>(["email", "magiclink"]);

function redirectResponse(url: URL) {
  return NextResponse.redirect(url, {
    status: 303,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await createAtlasServerClient();

  if (tokenHash && type === "invite") {
    const redirectTo = safeInviteRedirect(
      request.nextUrl.origin,
      request.nextUrl.searchParams.get("redirect_to"),
    );
    const inviteId = redirectTo.searchParams.get("invite");

    if (!isValidInviteId(inviteId)) {
      return redirectResponse(new URL("/auth/error?reason=invalid_invite", request.url));
    }

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "invite",
    });

    if (error) {
      return redirectResponse(new URL("/auth/error?reason=expired_invite", request.url));
    }

    return redirectResponse(redirectTo);
  }

  let confirmationError: unknown = null;
  if (code) {
    ({ error: confirmationError } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type && HUMAN_OTP_TYPES.has(type)) {
    ({ error: confirmationError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    }));
  } else {
    confirmationError = new Error("Missing Atlas account confirmation.");
  }

  if (confirmationError) {
    return redirectResponse(new URL("/auth/error?reason=confirmation_failed", request.url));
  }

  const destination = new URL(
    atlasAuthConfirmationNext(request.nextUrl.searchParams.get("next")),
    request.nextUrl.origin,
  );
  return redirectResponse(destination);
}
