import { NextResponse } from "next/server";

import { getAtlasSession, membershipForFarm } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ inviteId: string }> },
) {
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

  if (!farmId || !UUID_PATTERN.test(inviteId)) {
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
  const { data, error } = await supabase.rpc("owner_revoke_membership_invite_v1", {
    p_farm_id: farmId,
    p_invite_id: inviteId,
  });

  if (error || data !== true) {
    return NextResponse.json(
      { ok: false, error: "Atlas could not remove that invitation draft." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
