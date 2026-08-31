import { NextResponse } from "next/server";

import {
  getAtlasSession,
  membershipForOrganization,
} from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

type CompanyWorkRow = {
  organization_id: string;
  work_item_id: string;
  title: string;
  instructions: string | null;
  work_state: "open" | "completed" | "cancelled" | "superseded";
  operation_class: string | null;
  jurisdiction_key: string | null;
  source_object_type: string | null;
  source_object_id: string | null;
  created_at: string;
  updated_at: string;
  responsible_allocation_id: string | null;
  assignee_membership_id: string | null;
  allocated_at: string | null;
  time_contract_id: string | null;
  earliest_lawful_at: string | null;
  preferred_start_at: string | null;
  preferred_end_at: string | null;
  latest_lawful_at: string | null;
  hard_finish_at: string | null;
  expected_duration_minutes: number | null;
  movement_policy: string | null;
  unresolved_dependency_count: number;
  open_planning_conflict_id: string | null;
  open_planning_conflict_kind: string | null;
  open_planning_conflict_reason: string | null;
  conflict_required_by: string | null;
  management_position:
    | "unassigned"
    | "allocated"
    | "waiting_dependency"
    | "planning_conflict";
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "company-work-kernel-v1",
    },
  });
}

function summarize(rows: CompanyWorkRow[]) {
  const open = rows.filter((row) => row.work_state === "open");
  return {
    totalOpen: open.length,
    unassigned: open.filter((row) => row.management_position === "unassigned").length,
    allocated: open.filter((row) => row.management_position === "allocated").length,
    waitingDependency: open.filter((row) => row.management_position === "waiting_dependency").length,
    planningConflict: open.filter((row) => row.management_position === "planning_conflict").length,
  };
}

export async function GET(request: Request) {
  const session = await getAtlasSession();
  if (!session) {
    return privateJson({ ok: false, error: "Sign in required." }, 401);
  }

  const url = new URL(request.url);
  const organizationId =
    url.searchParams.get("organizationId")?.trim() || session.activeOrganizationId;

  if (!organizationId) {
    return privateJson(
      { ok: false, error: "An active organization is required." },
      403,
    );
  }

  const membership = membershipForOrganization(session, organizationId);
  if (!membership) {
    return privateJson(
      { ok: false, error: "Active organization membership is required." },
      403,
    );
  }

  if (membership.role !== "owner") {
    return privateJson(
      { ok: false, error: "Company Work currently requires organization-owner access." },
      403,
    );
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("company_work_position_api_v1", {
    p_organization_id: organizationId,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "Organization access is not active." }, 403);
    }
    if (rpcError.code === "PGRST202" || rpcError.code === "42883" || rpcError.code === "42P01") {
      return privateJson(
        {
          ok: false,
          error: "Company Work is not live in this database yet.",
          code: "company_work_kernel_not_live",
        },
        503,
      );
    }

    console.error("Atlas Company Work read failed:", error);
    return privateJson({ ok: false, error: "Atlas Company Work read failed." }, 500);
  }

  const rows = (data ?? []) as CompanyWorkRow[];
  return privateJson({
    ok: true,
    organization: {
      id: membership.organizationId,
      key: membership.organizationKey,
      name: membership.organizationName,
      role: membership.role,
      membershipId: membership.membershipId,
    },
    summary: summarize(rows),
    companyWork: rows,
  });
}
