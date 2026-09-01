import { redirect } from "next/navigation";

import PersonAtlasNotebookV2 from "@/app/owner/PersonAtlasNotebookV2";
import { atlasFarmDateIso, atlasFarmDateLabel } from "@/lib/atlas/farm-day";
import { readPersonAtlasProjection } from "@/lib/atlas/person-atlas-server";
import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

export default async function PersonAtlasTodayPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const forDate = atlasFarmDateIso();
  const projection = await readPersonAtlasProjection(session, forDate);

  return (
    <PersonAtlasNotebookV2
      identity={session.displayName || "Your Atlas"}
      greeting="your atlas"
      pageKicker="ONE LIFE"
      pageTitle="Today"
      dateLabelOverride={atlasFarmDateLabel(forDate, { weekday: "short", month: "short", day: "numeric" })}
      sections={projection.sections}
      sourceLinks={projection.sourceLinks}
      utilityGroups={[
        {
          label: "YOUR ATLAS",
          items: [
            {
              label: "Overview",
              detail: "Everything you are carrying",
              href: "/atlas",
            },
            {
              label: "Remember something",
              detail: "Private one-off memory",
              href: "/atlas/capture",
            },
            {
              label: "Released work",
              detail: "The bounded move Atlas has put in your hand",
              href: "/day",
            },
          ],
        },
      ]}
    />
  );
}
