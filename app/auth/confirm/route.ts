import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { isValidInviteId, safeInviteRedirect } from "@/lib/atlas/invite-flow-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const redirectTo = safeInviteRedirect(
    request.nextUrl.origin,
    request.nextUrl.searchParams.get("redirect_to"),
  );
  const inviteId = redirectTo.searchParams.get("invite");

  if (!tokenHash || type !== "invite" || !isValidInviteId(inviteId)) {
    return NextResponse.redirect(new URL("/auth/error?reason=invalid_invite", request.url));
  }

  const supabase = await createAtlasServerClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "invite",
  });

  if (error) {
    return NextResponse.redirect(new URL("/auth/error?reason=expired_invite", request.url));
  }

  return NextResponse.redirect(redirectTo, { status: 303 });
}
