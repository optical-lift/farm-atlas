import { NextResponse } from "next/server";

import {
  isValidInviteId,
  membershipHomeForRole,
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

  const inviteId =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { inviteId?: unknown }).inviteId === "string"
      ? (body as { inviteId: string }).inviteId.trim()
      : "";

  if (!isValidInviteId(inviteId)) {
    return NextResponse.json({ ok: false, error: "Invalid invitation." }, { status: 400 });
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("accept_membership_invite_v1", {
    p_invite_id: inviteId,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "This invitation is not available to the signed-in account." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
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
