import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import type { AtlasSessionOrganizationMembership } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

type PortfolioProjectRow = {
  id: string;
  organization_id: string;
  farm_id: string | null;
  parent_project_id: string | null;
  stable_key: string;
  title: string;
  status: string;
  workstream: string;
  project_kind: string;
  portfolio_type: string;
  reality_state: string;
  reality_state_reason: string | null;
  health_status: string;
  outcome_text: string | null;
  current_milestone: string | null;
  target_date: string | null;
  last_movement_at: string | null;
  sort_order: number;
};

type PortfolioFarmRow = {
  id: string;
  stable_key: string;
  name: string;
  status: string;
  north_star_text: string | null;
};

type PortfolioOrganizationRow = {
  id: string;
  stable_key: string;
  name: string;
  status: string;
};

export type OwnerPortfolioInitiative = {
  id: string;
  stableKey: string;
  title: string;
  status: string;
  workstream: string;
  projectKind: string;
  portfolioType: string;
  realityState: string;
  realityStateReason: string | null;
  healthStatus: string;
  outcome: string | null;
  currentMilestone: string | null;
  targetDate: string | null;
  lastMovementAt: string | null;
  parentProjectId: string | null;
};

export type OwnerPortfolioUnit = {
  id: string;
  stableKey: string;
  name: string;
  status: string;
  northStar: string | null;
  portfolioRole: null;
  horizon: null;
  investmentThesis: null;
  financialPosition: null;
  initiatives: OwnerPortfolioInitiative[];
  counts: {
    activeInitiatives: number;
    movingInitiatives: number;
    quietInitiatives: number;
    unhealthyInitiatives: number;
  };
};

export type OwnerPortfolioProjection = {
  organization: {
    id: string;
    stableKey: string;
    name: string;
    status: string;
  };
  operatingUnits: OwnerPortfolioUnit[];
  portfolioInitiatives: OwnerPortfolioInitiative[];
  dataReadiness: {
    portfolioRoles: "missing";
    horizons: "missing";
    investmentTheses: "missing";
    financialPosition: "external_source_required";
    ownerObligations: "domain_not_yet_implemented";
    attentionPolicy: "domain_not_yet_implemented";
    escalationPolicy: "domain_not_yet_implemented";
  };
};

function initiative(row: PortfolioProjectRow): OwnerPortfolioInitiative {
  return {
    id: row.id,
    stableKey: row.stable_key,
    title: row.title,
    status: row.status,
    workstream: row.workstream,
    projectKind: row.project_kind,
    portfolioType: row.portfolio_type,
    realityState: row.reality_state,
    realityStateReason: row.reality_state_reason,
    healthStatus: row.health_status,
    outcome: row.outcome_text,
    currentMilestone: row.current_milestone,
    targetDate: row.target_date,
    lastMovementAt: row.last_movement_at,
    parentProjectId: row.parent_project_id,
  };
}

function initiativeSort(left: PortfolioProjectRow, right: PortfolioProjectRow) {
  if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
  return left.title.localeCompare(right.title);
}

function ownerOrganization(access: AtlasRoleAccess): AtlasSessionOrganizationMembership {
  if (access.membership.role !== "owner") {
    throw new Error("Owner membership required.");
  }

  const activeOrganization = access.session.activeOrganizationId
    ? access.session.organizationMemberships.find(
        (membership) =>
          membership.organizationId === access.session.activeOrganizationId
          && membership.role === "owner",
      )
    : null;

  const membership = activeOrganization
    ?? access.session.organizationMemberships.find((candidate) => candidate.role === "owner")
    ?? null;

  if (!membership) {
    throw new Error("Owner organization membership required.");
  }

  return membership;
}

function unitCounts(rows: PortfolioProjectRow[]) {
  return {
    activeInitiatives: rows.filter((row) => row.status !== "archived").length,
    movingInitiatives: rows.filter((row) => row.health_status === "moving").length,
    quietInitiatives: rows.filter((row) => row.health_status === "quiet").length,
    unhealthyInitiatives: rows.filter(
      (row) => !["moving", "quiet", "healthy"].includes(row.health_status),
    ).length,
  };
}

/**
 * Transitional organization-rooted Owner read.
 *
 * This deliberately does not infer portfolio role, horizon, thesis, financial
 * position, Owner obligations, attention policy, or escalation state from
 * farm/task data. Those are first-class portfolio domains still to be built.
 */
export async function getOwnerPortfolio(
  access: AtlasRoleAccess,
): Promise<OwnerPortfolioProjection> {
  const organizationMembership = ownerOrganization(access);
  const organizationId = organizationMembership.organizationId;
  const supabase = await createAtlasServerClient();

  const [organizationRead, farmsRead, projectsRead] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, stable_key, name, status")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("farms")
      .select("id, stable_key, name, status, north_star_text")
      .eq("organization_id", organizationId)
      .order("name"),
    supabase
      .from("projects")
      .select(
        "id, organization_id, farm_id, parent_project_id, stable_key, title, status, workstream, project_kind, portfolio_type, reality_state, reality_state_reason, health_status, outcome_text, current_milestone, target_date, last_movement_at, sort_order",
      )
      .eq("organization_id", organizationId)
      .neq("status", "archived")
      .order("sort_order")
      .order("title"),
  ]);

  if (organizationRead.error) throw new Error("Owner portfolio organization read failed.");
  if (farmsRead.error) throw new Error("Owner portfolio operating-unit read failed.");
  if (projectsRead.error) throw new Error("Owner portfolio initiative read failed.");
  if (!organizationRead.data) throw new Error("Owner portfolio organization not found.");

  const organization = organizationRead.data as PortfolioOrganizationRow;
  const farms = (farmsRead.data ?? []) as PortfolioFarmRow[];
  const projects = ((projectsRead.data ?? []) as PortfolioProjectRow[]).sort(initiativeSort);

  const projectsByFarm = new Map<string, PortfolioProjectRow[]>();
  for (const project of projects) {
    if (!project.farm_id) continue;
    const current = projectsByFarm.get(project.farm_id) ?? [];
    current.push(project);
    projectsByFarm.set(project.farm_id, current);
  }

  const operatingUnits: OwnerPortfolioUnit[] = farms.map((farm) => {
    const rows = projectsByFarm.get(farm.id) ?? [];
    return {
      id: farm.id,
      stableKey: farm.stable_key,
      name: farm.name,
      status: farm.status,
      northStar: farm.north_star_text,
      portfolioRole: null,
      horizon: null,
      investmentThesis: null,
      financialPosition: null,
      initiatives: rows.map(initiative),
      counts: unitCounts(rows),
    };
  });

  return {
    organization: {
      id: organization.id,
      stableKey: organization.stable_key,
      name: organization.name,
      status: organization.status,
    },
    operatingUnits,
    portfolioInitiatives: projects.filter((project) => !project.farm_id).map(initiative),
    dataReadiness: {
      portfolioRoles: "missing",
      horizons: "missing",
      investmentTheses: "missing",
      financialPosition: "external_source_required",
      ownerObligations: "domain_not_yet_implemented",
      attentionPolicy: "domain_not_yet_implemented",
      escalationPolicy: "domain_not_yet_implemented",
    },
  };
}
