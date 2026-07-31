import Link from "next/link";
import { redirect } from "next/navigation";

import { AtlasAppShell, AtlasTopBar } from "@/components/atlas/ui/AtlasPrimitives";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

import BiologicalRhythmManager, { type BiologicalRhythmDashboard } from "./BiologicalRhythmManager";
import styles from "./rhythms.module.css";

export const dynamic = "force-dynamic";

type RhythmSearchParams = Record<string, string | string[] | undefined>;

type RhythmPageProps = {
  searchParams?: Promise<RhythmSearchParams>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function BiologicalRhythmsPage({ searchParams }: RhythmPageProps) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const ownerMemberships = session.memberships.filter((membership) => membership.role === "owner");
  if (!ownerMemberships.length) redirect("/more");

  const params = searchParams ? await searchParams : {};
  const requestedFarmKey = firstParam(params.farm);
  const selectedMembership = ownerMemberships.find((membership) => membership.farmKey === requestedFarmKey)
    ?? ownerMemberships.find((membership) => membership.farmId === session.activeFarmId)
    ?? ownerMemberships[0];

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("biological_rhythm_dashboard_v1", {
    p_farm_id: selectedMembership.farmId,
  });
  if (error) throw new Error("Atlas could not read the biological Rulebook.");

  const dashboard = (data ?? {
    contractVersion: "biological_rhythm_dashboard_v1",
    farmId: selectedMembership.farmId,
    items: [],
  }) as BiologicalRhythmDashboard;

  return (
    <AtlasAppShell className={styles.shell} frameClassName={styles.frame}>
      <AtlasTopBar
        title="Rulebook + Clock"
        status={<span>{selectedMembership.farmName ?? "Farm rhythms"}</span>}
        action={<Link href="/more" className={styles.back}>More</Link>}
      />

      <div className={styles.page}>
        {ownerMemberships.length > 1 ? (
          <nav className={styles.farmTabs} aria-label="Choose a farm Rulebook">
            {ownerMemberships.map((membership) => (
              <Link
                key={membership.membershipId}
                href={`/manage/rhythms?farm=${encodeURIComponent(membership.farmKey ?? membership.farmId)}`}
                aria-current={membership.farmId === selectedMembership.farmId ? "page" : undefined}
              >
                {membership.farmName ?? "Farm"}
              </Link>
            ))}
          </nav>
        ) : null}

        <header className={styles.intro}>
          <span>Owner controls</span>
          <h1>Biological rhythms</h1>
          <p>Atlas may open a care round or observation window when time crosses a boundary. It never uses time alone to claim what is physically happening.</p>
        </header>

        <BiologicalRhythmManager dashboard={dashboard} />
      </div>
    </AtlasAppShell>
  );
}
