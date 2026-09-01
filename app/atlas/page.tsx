import { redirect } from "next/navigation";

import AtlasResponsibilityOverview from "@/app/atlas/AtlasResponsibilityOverview";
import { atlasFarmDateIso, atlasFarmDateLabel } from "@/lib/atlas/farm-day";
import { readPersonAtlasProjection } from "@/lib/atlas/person-atlas-server";
import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

export default async function PersonAtlasPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const forDate = atlasFarmDateIso();
  const projection = await readPersonAtlasProjection(session, forDate);

  return (
    <AtlasResponsibilityOverview
      identity={session.displayName || "Your Atlas"}
      dateLabel={atlasFarmDateLabel(forDate, { weekday: "short", month: "short", day: "numeric" })}
      sections={projection.sections}
      sourceLinks={projection.sourceLinks}
      counts={projection.counts}
    />
  );
}
