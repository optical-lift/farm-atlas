import { NextRequest, NextResponse } from "next/server";

import { invitationsEnabled, isValidInviteId } from "@/lib/atlas/invite-flow-core.js";
import { getAtlasSession, membershipForFarm } from "@/lib/atlas/session";
import { createAtlasAdminClient } from "@/lib/supabase/admin";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type InviteRow = {
  invite_id: string;
  farm_id: string;
  email: string;
  display_name: string;
  role: "manager" | "farm_hand";
  worker_key: string | null;
  status: string;
  auth_user_id: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> },
) {
  if (!invitationsEnabled(process.env.ATLAS_INVITES_ENABLED)) {
    return NextResponse.json(
      { ok: false, error: "Invitation sending is disabled while Atlas onboarding is being built." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const session = await getAtlasSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const farmId =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { farmId?: unknown }).farmId === "string"
      ? (body as { farmId: string }).farmId.trim()
      : "";
  const { inviteId } = await params;

  if (!farmId || !isValidInviteId(inviteId)) {
    return NextResponse.json({ ok: false, error: "Invalid invitation." }, { status: 400 });
  }

  const membership = membershipForFarm(session, farmId);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json(
      { ok: false, error: "Owner membership required." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const supabase = await createAtlasServerClient();
  const { data: inviteRows, error: inviteError } = await supabase.rpc(
    "owner_get_membership_invite_v1",
    {
      p_farm_id: farmId,
      p_invite_id: inviteId,
    },
  );

  const invite = ((inviteRows ?? []) as InviteRow[])[0] ?? null;
  if (inviteError || !invite) {
    return NextResponse.json(
      { ok: false, error: "Invitation draft not found." },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const publicOrigin = process.env.ATLAS_PUBLIC_ORIGIN ?? request.nextUrl.origin;
  const redirectTo = new URL("/onboarding/invite", publicOrigin);
  redirectTo.searchParams.set("invite", inviteId);

  const admin = createAtlasAdminClient();
  const { data: invited, error: sendError } = await admin.auth.admin.inviteUserByEmail(
    invite.email,
    {
      redirectTo: redirectTo.toString(),
      data: {
        display_name: invite.display_name,
        atlas_invite_id: inviteId,
      },
    },
  );

  if (sendError || !invited.user) {
    await supabase.rpc("owner_mark_membership_invite_error_v1", {
      p_farm_id: farmId,
      p_invite_id: inviteId,
      p_error: sendError?.message ?? "Supabase Auth did not return an invited user.",
    });

    return NextResponse.json(
      { ok: false, error: "Supabase could not send that invitation." },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { data: markedSent, error: markError } = await supabase.rpc(
    "owner_mark_membership_invite_sent_v1",
    {
      p_farm_id: farmId,
      p_invite_id: inviteId,
      p_auth_user_id: invited.user.id,
    },
  );

  if (markError || markedSent !== true) {
    await admin.auth.admin.deleteUser(invited.user.id);
    await supabase.rpc("owner_mark_membership_invite_error_v1", {
      p_farm_id: farmId,
      p_invite_id: inviteId,
      p_error: markError?.message ?? "Atlas could not attach the Auth invitation.",
    });

    return NextResponse.json(
      { ok: false, error: "Atlas could not finish recording that invitation." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, sent: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
