import { NextResponse } from "next/server";

import {
  isValidInviteId,
  membershipHomeForRole,
  validateInvitePassword,
} from "@/lib/atlas/invite-flow-core.js";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AcceptanceResult = {
  membershipId?: unknown;
  farmId?: unknown;
  role?: unknown;
  workerKey?: unknown;
  assignedTaskCount?: unknown;
};

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
    body = {};
  }

  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const inviteId =
    typeof (source as { inviteId?: unknown }).inviteId === "string"
      ? (source as { inviteId: string }).inviteId.trim()
      : "";
  const password =
    typeof (source as { password?: unknown }).password === "string"
      ? (source as { password: string }).password
      : "";
  const confirmation =
    typeof (source as { confirmation?: unknown }).confirmation === "string"
      ? (source as { confirmation: string }).confirmation
      : "";

  if (!isValidInviteId(inviteId)) {
    return NextResponse.json({ ok: false, error: "Invalid invitation." }, { status: 400 });
  }

  const passwordCheck = validateInvitePassword(password, confirmation);
  if (!passwordCheck.ok) {
    return NextResponse.json({ ok: false, error: passwordCheck.error }, { status: 400 });
  }

  const supabase = await createAtlasServerClient();
  const { data: pending, error: pendingError } = await supabase.rpc(
    "pending_membership_invite_for_current_user_v1",
    { p_invite_id: inviteId },
  );

  if (pendingError || !Array.isArray(pending) || pending.length === 0) {
    return NextResponse.json(
      { ok: false, error: "This invitation is not available to the signed-in account." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { error: passwordError } = await supabase.auth.updateUser({
    password: passwordCheck.password,
  });

  if (passwordError) {
    return NextResponse.json(
      { ok: false, error: "Atlas could not set the password for this account." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { data, error } = await supabase.rpc("accept_membership_invite_v1", {
    p_invite_id: inviteId,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Atlas could not finish attaching this farm membership." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const result = (data ?? {}) as AcceptanceResult;
  const role = typeof result.role === "string" ? result.role : null;
  const assignedTaskCount =
    typeof result.assignedTaskCount === "number" ? result.assignedTaskCount : 0;

  return NextResponse.json(
    {
      ok: true,
      home: membershipHomeForRole(role),
      assignedTaskCount,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
