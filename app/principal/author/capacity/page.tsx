import Link from "next/link";
import { redirect } from "next/navigation";

import { readAtlasPrincipalCapacityPolicies } from "@/lib/atlas/principal-capacity-policy";
import { readAtlasPrincipalSelfContext } from "@/lib/atlas/principal-self-context";
import { getAtlasSession } from "@/lib/atlas/session";

import PrincipalCapacityAuthoringClient from "./PrincipalCapacityAuthoringClient";

export const dynamic = "force-dynamic";

const shellStyle = {
  minHeight: "100vh",
  background: "#f5f1e8",
  color: "#262626",
  padding: "24px 16px 48px",
} as const;
const pageStyle = { width: "min(980px, 100%)", margin: "0 auto", display: "grid", gap: 16 } as const;
const cardStyle = {
  border: "1px solid rgba(38, 38, 38, 0.12)",
  borderRadius: 18,
  background: "rgba(255,255,255,.76)",
  padding: 18,
  boxShadow: "0 10px 32px rgba(47,43,31,.045)",
} as const;

export default async function AtlasPrincipalCapacityAuthorPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");
  if (!session.organizationMemberships.some((membership) => membership.role === "owner")) redirect("/");

  const [context, capacityPolicies] = await Promise.all([
    readAtlasPrincipalSelfContext(),
    readAtlasPrincipalCapacityPolicies(),
  ]);
  if (context.state !== "ready" || !context.principal) redirect("/principal");

  const householdName = context.household?.name || "Household";
  const householdTimezone = context.household?.timezone || context.principal.homeTimezone || "America/Chicago";
  const currentPolicy = capacityPolicies[0] ?? null;

  return (
    <main style={shellStyle}>
      <div style={pageStyle}>
        <header style={{ ...cardStyle, background: "#24251f", color: "#f8f4e8" }}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .7 }}>Atlas · Household &amp; Principal Capacity</span>
          <h1 style={{ margin: "6px 0 0", fontSize: "clamp(30px, 6vw, 48px)", lineHeight: 1 }}>Make available time a real constraint</h1>
          <p style={{ margin: "10px 0 0", maxWidth: 760, lineHeight: 1.55, opacity: .8 }}>
            Atlas should never read an empty calendar as infinite capacity. Define the Principal day, then let household and human reality subtract from that boundary before portfolio work is allowed to fill it.
          </p>
          <nav style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 16 }}>
            <Link href="/principal" style={{ color: "inherit", fontWeight: 800 }}>← Principal</Link>
            <Link href="/principal/author" style={{ color: "inherit", fontWeight: 800 }}>Obligations &amp; theses</Link>
            <Link href="/principal/author/office" style={{ color: "inherit", fontWeight: 800 }}>Office authoring</Link>
          </nav>
        </header>

        <section style={cardStyle}>
          <strong>Household is not farm work</strong>
          <p style={{ margin: "7px 0 0", lineHeight: 1.55, opacity: .74 }}>
            The governing model treats meals, family needs, cleaning rhythms, home maintenance, and household commitments as a protected Principal domain. They constrain business capacity without becoming farm tasks. Daily maintenance, weekly recurring care, and the five-zone rotation are encoded as household rhythms, not delegated operating work.
          </p>
        </section>

        <PrincipalCapacityAuthoringClient householdName={householdName} householdTimezone={householdTimezone} currentPolicy={currentPolicy} />
      </div>
    </main>
  );
}
