import { NextResponse } from "next/server";

import { membershipForOrganization, getAtlasSession } from "@/lib/atlas/session";
import type {
  CompanyWorkPlanDraft,
  CompanyWorkPlanningQueueItem,
} from "@/lib/atlas/company-work-planning";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

type PlanningRequest =
  | {
      action: "plan_week";
      organizationId: string;
      weekStart: string;
      plans: CompanyWorkPlanDraft[];
    }
  | {
      action: "clear_plan";
      organizationId: string;
      workItemId: string;
      reason?: string | null;
    };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "company-work-weekly-planning-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return privateJson({ ok: false, error: "Organization-owner authority is required." }, 403);
  }
  if (error.code === "22023" || error.code === "23514") {
    return privateJson({ ok: false, error: error.message ?? "The plan is not lawful." }, 409);
  }
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") {
    return privateJson(
      {
        ok: false,
        error: "The Company Work planning contract is not live in this database yet.",
        code: "company_work_planning_not_live",
      },
      503,
    );
  }
  console.error("Atlas Company Work planning failed:", error);
  return privateJson({ ok: false, error: "Atlas Company Work planning failed." }, 500);
}

async function authorizedOrganization(organizationId: string | null) {
  const session = await getAtlasSession();
  if (!session) return { response: privateJson({ ok: false, error: "Sign in required." }, 401) };

  const resolvedOrganizationId = organizationId?.trim() || session.activeOrganizationId;
  if (!resolvedOrganizationId) {
    return {
      response: privateJson({ ok: false, error: "An active organization is required." }, 403),
    };
  }

  const membership = membershipForOrganization(session, resolvedOrganizationId);
  if (!membership) {
    return {
      response: privateJson({ ok: false, error: "Active organization membership is required." }, 403),
    };
  }

  // The live planning RPCs are intentionally owner-authorized today. Keep this
  // application boundary aligned with the database rather than widening it here.
  if (membership.role !== "owner") {
    return {
      response: privateJson(
        { ok: false, error: "Company Work weekly planning currently requires organization-owner access." },
        403,
      ),
    };
  }

  return { session, membership, organizationId: resolvedOrganizationId };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const access = await authorizedOrganization(url.searchParams.get("organizationId"));
  if ("response" in access) return access.response;

  const weekStart = url.searchParams.get("weekStart")?.trim();
  if (!weekStart) {
    return privateJson({ ok: false, error: "weekStart is required." }, 400);
  }

  const start = new Date(`${weekStart}T12:00:00`);
  if (Number.isNaN(start.getTime())) {
    return privateJson({ ok: false, error: "weekStart must be a valid date." }, 400);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const weekEnd = [end.getFullYear(), `${end.getMonth() + 1}`.padStart(2, "0"), `${end.getDate()}`.padStart(2, "0")].join("-");

  const supabase = await createAtlasServerClient();
  // Read the whole open queue. Windowing the RPC would hide unassigned Work with
  // no source-owned date, which is exactly the Work management still needs to see.
  const { data, error } = await supabase.rpc("organization_owner_company_work_planning_queue_api_v2", {
    p_organization_id: access.organizationId,
    p_window_start: null,
    p_window_end: null,
  });

  if (error) return rpcFailure(error as RpcError);

  return privateJson({
    ok: true,
    organization: {
      id: access.membership.organizationId,
      key: access.membership.organizationKey,
      name: access.membership.organizationName,
      role: access.membership.role,
      membershipId: access.membership.membershipId,
    },
    weekStart,
    weekEnd,
    companyWork: (data ?? []) as CompanyWorkPlanningQueueItem[],
  });
}

export async function POST(request: Request) {
  let body: PlanningRequest;
  try {
    body = (await request.json()) as PlanningRequest;
  } catch {
    return privateJson({ ok: false, error: "A JSON planning request is required." }, 400);
  }

  if (!body || typeof body !== "object" || !("organizationId" in body)) {
    return privateJson({ ok: false, error: "organizationId is required." }, 400);
  }

  const access = await authorizedOrganization(body.organizationId);
  if ("response" in access) return access.response;
  const supabase = await createAtlasServerClient();

  if (body.action === "plan_week") {
    if (!body.weekStart || !Array.isArray(body.plans) || body.plans.length === 0) {
      return privateJson({ ok: false, error: "A week start and at least one plan are required." }, 400);
    }
    const { data, error } = await supabase.rpc("organization_owner_plan_company_work_week_api_v1", {
      p_organization_id: access.organizationId,
      p_week_start: body.weekStart,
      p_plans: body.plans,
    });
    if (error) return rpcFailure(error as RpcError);
    return privateJson({ ok: true, result: data });
  }

  if (body.action === "clear_plan") {
    if (!body.workItemId) {
      return privateJson({ ok: false, error: "workItemId is required." }, 400);
    }
    const { data, error } = await supabase.rpc("organization_owner_clear_company_work_plan_api_v1", {
      p_work_item_id: body.workItemId,
      p_reason: body.reason ?? null,
    });
    if (error) return rpcFailure(error as RpcError);
    return privateJson({ ok: true, result: data });
  }

  return privateJson({ ok: false, error: "Unknown planning action." }, 400);
}
