import { notFound } from "next/navigation";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()));
}

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(date);
}

export default async function FarmRoundPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const date = firstValue(query.date);
  if (!validDate(date)) notFound();

  const session = await getAtlasSession();
  if (!session) notFound();
  const membership = session.memberships.find((candidate) => candidate.farmId === session.activeFarmId) ?? session.memberships[0] ?? null;
  if (!membership) notFound();

  return (
    <main style={{ minHeight: "100%", padding: "18px 14px 120px", background: "var(--atlas-app-background,#f4efe6)" }} data-atlas-farm-round-preview="true">
      <div style={{ width: "min(100%,520px)", margin: "0 auto" }}>
        <AtlasTaskCardFrame
          family="Stewardship"
          familyDetail="Planned recurring round"
          title="Farm Round"
          subtitle={membership.farmName ?? "Elm Farm"}
          timing={`Scheduled · ${prettyDate(date as string)}`}
          completion={false}
        >
          <section style={{ margin: 18, borderRadius: 16, padding: "14px 15px", background: "rgba(174,179,212,.1)", color: "#505363" }}>
            <small style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase", opacity: .62 }}>Planning preview</small>
            <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45, fontWeight: 700 }}>This is the real future Farm Round slot. Its walking-route checklist and result controls appear when Clock materializes the executable round for this date.</p>
          </section>
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
