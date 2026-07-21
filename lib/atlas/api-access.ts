import { NextResponse } from "next/server";

import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import {
  getAtlasSession,
  membershipForFarm,
  type AtlasFarmRole,
} from "@/lib/atlas/session";

type AtlasApiAccessOptions = {
  farmId?: string | null;
  allowedRoles?: AtlasFarmRole[];
};

type AtlasApiAccessResult =
  | {
      ok: true;
      access: AtlasRoleAccess;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export function atlasApiError(
  status: number,
  code: string,
  message: string,
) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function requireAtlasApiAccess(
  options: AtlasApiAccessOptions = {},
): Promise<AtlasApiAccessResult> {
  const session = await getAtlasSession();
  if (!session) {
    return {
      ok: false,
      response: atlasApiError(401, "sign_in_required", "Sign in required."),
    };
  }

  const farmId = options.farmId?.trim() || session.activeFarmId;
  if (!farmId) {
    return {
      ok: false,
      response: atlasApiError(
        403,
        "farm_membership_required",
        "An active farm membership is required.",
      ),
    };
  }

  const membership = membershipForFarm(session, farmId);
  if (!membership) {
    return {
      ok: false,
      response: atlasApiError(
        403,
        "farm_membership_required",
        "An active farm membership is required.",
      ),
    };
  }

  if (
    options.allowedRoles?.length &&
    !options.allowedRoles.includes(membership.role)
  ) {
    return {
      ok: false,
      response: atlasApiError(
        403,
        "role_not_authorized",
        "This farm role cannot use that Atlas operation.",
      ),
    };
  }

  return {
    ok: true,
    access: { session, membership },
  };
}

export async function readAtlasJsonBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Atlas requests must use JSON.");
  }

  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Atlas request body must be an object.");
  }

  return body as Record<string, unknown>;
}
