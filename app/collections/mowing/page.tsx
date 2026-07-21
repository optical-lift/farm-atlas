import CanonicalMaintenanceCollectionView from "@/components/atlas/CanonicalMaintenanceCollectionView";
import { getTaskSchedule } from "@/lib/atlas-data/task-schedule";
import { addScheduleDays } from "@/lib/atlas/task-schedule-core.js";
import { centralDateIso } from "@/lib/atlas/date";
import { requireAtlasRole } from "@/lib/atlas/role-access";

export const dynamic = "force-dynamic";

export default async function MowingCollectionPage() {
  const access = await requireAtlasRole(["owner", "manager", "farm_hand"]);
  const today = centralDateIso();
  const schedule = await getTaskSchedule(access, {
    startDate: addScheduleDays(today, -7),
    endDate: addScheduleDays(today, 7),
    includeOverdue: true,
    includeUndated: true,
  });

  return (
    <CanonicalMaintenanceCollectionView
      route="mow"
      title="Mowing"
      subtitle="rotation + growth checks"
      today={today}
      schedule={schedule}
      role={access.membership.role}
    />
  );
}
