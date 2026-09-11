import CompanyWorkWeeklyPlanner from "../CompanyWorkWeeklyPlanner";
import {
  mondayForDate,
  parseLocalDateKey,
  toLocalDateKey,
} from "@/lib/atlas/company-work-planning";
import { getAtlasSession } from "@/lib/atlas/session";

function chicagoDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default async function CompanyWorkWeekPage() {
  const session = await getAtlasSession();
  const membership = session
    ? session.organizationMemberships.find(
        (entry) => entry.organizationId === session.activeOrganizationId,
      ) ?? session.organizationMemberships[0] ?? null
    : null;

  if (!session || !membership) {
    return (
      <main style={{ padding: 40, fontFamily: '"Source Sans 3", system-ui, sans-serif' }}>
        <p>An active organization membership is required for Company Work weekly planning.</p>
      </main>
    );
  }

  const today = parseLocalDateKey(chicagoDateKey());
  const initialWeekStart = toLocalDateKey(mondayForDate(today));

  return (
    <CompanyWorkWeeklyPlanner
      organization={{
        id: membership.organizationId,
        key: membership.organizationKey,
        name: membership.organizationName,
        role: membership.role,
        membershipId: membership.membershipId,
      }}
      initialWeekStart={initialWeekStart}
    />
  );
}
