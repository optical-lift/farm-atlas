import { NextResponse } from "next/server";

import { normalizeMembershipInviteInput } from "@/lib/atlas/member-invite-core.js";
import { getAtlasSession, membershipForFarm } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
    return NextResponse.json({ ok: false, error: "Enter the invitation details." }, { status: 400 });
  }

  const normalized = normalizeMembershipInviteInput(body);
  if (!normalized.ok) {
    return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
  }

  const input = normalized.value;
  const membership = membershipForFarm(session, input.farmId);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json(
      { ok: false, error: "Owner membership required." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_prepare_membership_invite_v1", {
    p_farm_id: input.farmId,
    p_email: input.email,
    p_display_name: input.displayName,
    p_role: input.role,
    p_worker_key: input.workerKey,
  });

  if (error) {
    const message = error.code === "23505"
      ? "That email or worker key is already attached to this farm."
      : "Atlas could not prepare that invitation.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, inviteId: data, sent: false },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
