import { NextResponse } from "next/server";

import { getAtlasSession, type AtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type WorkAlongsideBody = {
  farmId?: string;
  teammateMembershipId?: string;
  startsOn?: string;
  endsOn?: string;
  windowId?: string;
};

type MembershipRow = {
  id: string;
  farm_id: string;
  user_id: string;
  role: string;
  worker_key: string | null;
  active: boolean;
};

type ProfileRow = {
  user_id: string;
  display_name: string;
};

type WindowRow = {
  id: string;
  farm_id: string;
  observer_membership_id: string;
  teammate_membership_id: string;
  starts_on: string;
  ends_on: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "work-alongside-v1",
    },
  });
}

function validDateIso(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ownerMembership(session: AtlasSession, requestedFarmId?: string | null) {
  if (requestedFarmId) {
    const requested = session.memberships.find(
      (membership) => membership.farmId === requestedFarmId && membership.role === "owner",
    );
    if (requested) return requested;
  }

  if (session.activeFarmId) {
    const active = session.memberships.find(
      (membership) => membership.farmId === session.activeFarmId && membership.role === "owner",
    );
    if (active) return active;
  }

  return session.memberships.find((membership) => membership.role === "owner") ?? null;
}

async function readWorkAlongsideSurface(session: AtlasSession, requestedFarmId?: string | null) {
  const observer = ownerMembership(session, requestedFarmId);
  if (!observer) throw new Error("Owner farm membership required.");

  const supabase = await createAtlasServerClient();
  const [membershipResponse, windowResponse] = await Promise.all([
    supabase
      .from("farm_memberships")
      .select("id, farm_id, user_id, role, worker_key, active")
      .eq("farm_id", observer.farmId)
      .eq("active", true)
      .order("role")
      .order("worker_key"),
    supabase
      .from("work_alongside_windows")
      .select("id, farm_id, observer_membership_id, teammate_membership_id, starts_on, ends_on, status, created_at, updated_at")
      .eq("observer_membership_id", observer.membershipId)
      .eq("status", "active")
      .order("starts_on")
      .order("created_at"),
  ]);

  if (membershipResponse.error) throw membershipResponse.error;
  if (windowResponse.error) throw windowResponse.error;

  const memberships = (membershipResponse.data ?? []) as MembershipRow[];
  const userIds = [...new Set(memberships.map((membership) => membership.user_id))];
  const profileResponse = userIds.length
    ? await supabase
        .from("user_profiles")
        .select("user_id, display_name")
        .in("user_id", userIds)
    : { data: [] as ProfileRow[], error: null };

  if (profileResponse.error) throw profileResponse.error;
  const profileByUser = new Map(
    ((profileResponse.data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile.display_name]),
  );

  const teammates = memberships
    .filter((membership) => membership.id !== observer.membershipId)
    .filter((membership) => membership.role === "manager" || membership.role === "farm_hand")
    .map((membership) => ({
      membershipId: membership.id,
      workerKey: membership.worker_key,
      role: membership.role,
      label: profileByUser.get(membership.user_id)
        || titleCase(membership.worker_key || membership.role),
    }));

  return {
    observer,
    teammates,
    windows: (windowResponse.data ?? []) as WindowRow[],
  };
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const url = new URL(request.url);
  try {
    const surface = await readWorkAlongsideSurface(session, url.searchParams.get("farmId"));
    return privateJson({
      ok: true,
      farmId: surface.observer.farmId,
      viewerMembershipId: surface.observer.membershipId,
      teammates: surface.teammates,
      windows: surface.windows.map((window) => ({
        windowId: window.id,
        teammateMembershipId: window.teammate_membership_id,
        startsOn: window.starts_on,
        endsOn: window.ends_on,
        status: window.status,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Work-alongside settings could not be read.";
    const status = message === "Owner farm membership required." ? 403 : 500;
    return privateJson({ ok: false, error: message }, status);
  }
}

export async function POST(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  let body: WorkAlongsideBody;
  try {
    body = await request.json() as WorkAlongsideBody;
  } catch {
    return privateJson({ ok: false, error: "A JSON request body is required." }, 400);
  }

  if (!body.teammateMembershipId || !validDateIso(body.startsOn) || !validDateIso(body.endsOn)) {
    return privateJson({ ok: false, error: "Choose a teammate and valid start and end dates." }, 400);
  }
  if (body.endsOn < body.startsOn) {
    return privateJson({ ok: false, error: "The end date cannot be before the start date." }, 400);
  }

  try {
    const surface = await readWorkAlongsideSurface(session, body.farmId);
    const teammate = surface.teammates.find(
      (membership) => membership.membershipId === body.teammateMembershipId,
    );
    if (!teammate) return privateJson({ ok: false, error: "That teammate is not active on this farm." }, 400);

    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase
      .from("work_alongside_windows")
      .upsert({
        farm_id: surface.observer.farmId,
        observer_membership_id: surface.observer.membershipId,
        teammate_membership_id: teammate.membershipId,
        starts_on: body.startsOn,
        ends_on: body.endsOn,
        status: "active",
        created_by_user_id: session.userId,
        metadata: { source: "atlas_work_feed" },
      }, {
        onConflict: "observer_membership_id,teammate_membership_id,starts_on,ends_on",
      })
      .select("id, teammate_membership_id, starts_on, ends_on, status")
      .single();

    if (error) throw error;
    return privateJson({ ok: true, window: data });
  } catch (error) {
    console.error("Atlas work-alongside write failed:", error);
    return privateJson({ ok: false, error: "The work-alongside window could not be saved." }, 500);
  }
}

export async function DELETE(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  let body: WorkAlongsideBody;
  try {
    body = await request.json() as WorkAlongsideBody;
  } catch {
    return privateJson({ ok: false, error: "A JSON request body is required." }, 400);
  }

  if (!body.windowId) return privateJson({ ok: false, error: "windowId is required." }, 400);

  try {
    const surface = await readWorkAlongsideSurface(session, body.farmId);
    const supabase = await createAtlasServerClient();
    const { error } = await supabase
      .from("work_alongside_windows")
      .delete()
      .eq("id", body.windowId)
      .eq("observer_membership_id", surface.observer.membershipId);

    if (error) throw error;
    return privateJson({ ok: true });
  } catch (error) {
    console.error("Atlas work-alongside delete failed:", error);
    return privateJson({ ok: false, error: "The work-alongside window could not be removed." }, 500);
  }
}
