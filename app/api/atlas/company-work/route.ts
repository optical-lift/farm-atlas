import { NextResponse } from "next/server";

import {
  getAtlasSession,
  membershipForOrganization,
} from "@/lib/atlas/session";
import {
  summarizeCompanyWork,
  type CompanyWorkRow,
} from "@/lib/atlas/company-work";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "company-work-kernel-v1",
    },
  });
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
    summary: summarizeCompanyWork(rows),
    companyWork: rows,
  });
}
