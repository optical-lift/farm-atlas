import { buildOwnerDashboardProjection } from "@/lib/atlas/owner-dashboard-core.js";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { getAuthorizedFarm } from "@/lib/atlas-data/farms";
import { getOwnerTaskRows } from "@/lib/atlas-data/tasks";

export type OwnerAction = {
  id: string | null;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  taskType: string;
  blocker: string | null;
  detail: string | null;
  totalSteps: number;
  completedSteps: number;
  workRoute: string | null;
};

export type OwnerDashboardProjection = {
  farm: {
    id: string | null;
    farmKey: string | null;
    name: string;
    status: string;
  };
  generatedForDate: string;
  weekEndDate: string;
  counts: {
    open: number;
    blocked: number;
    overdue: number;
    today: number;
    thisWeek: number;
    later: number;
  };
  ownerActions: {
    overdue: OwnerAction[];
    today: OwnerAction[];
    thisWeek: OwnerAction[];
    later: OwnerAction[];
    recentlyDone: OwnerAction[];
  };
  farmBlockers: unknown[];
  workerExecution: unknown[];
  upcomingDeadlines: unknown[];
};

function centralDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function getOwnerDashboard(
  access: AtlasRoleAccess,
): Promise<OwnerDashboardProjection> {
  if (access.membership.role !== "owner") {
    throw new Error("Owner membership required.");
  }

  const farmId = access.membership.farmId;
  const [farm, tasks] = await Promise.all([
    getAuthorizedFarm(farmId),
    getOwnerTaskRows(farmId),
  ]);

  return buildOwnerDashboardProjection({
    farm,
    tasks,
    todayIso: centralDateIso(),
  }) as OwnerDashboardProjection;
}
