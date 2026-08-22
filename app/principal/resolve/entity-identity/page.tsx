import Link from "next/link";
import { redirect } from "next/navigation";

import { readAtlasEntityIdentityReviewQueue } from "@/lib/atlas/entity-identity-review";
import { getAtlasSession } from "@/lib/atlas/session";

import EntityIdentityReviewClient from "./EntityIdentityReviewClient";

export const dynamic = "force-dynamic";

const shellStyle = {
  minHeight: "100vh",
  background: "#f5f1e8",
  color: "#262626",
  padding: "24px 16px 48px",
} as const;
const pageStyle = { width: "min(980px, 100%)", margin: "0 auto", display: "grid", gap: 16 } as const;
const cardStyle = {
  border: "1px solid rgba(38,38,38,.12)",
  borderRadius: 18,
  background: "rgba(255,255,255,.76)",
  padding: 18,
  boxShadow: "0 10px 32px rgba(47,43,31,.045)",
} as const;

export default async function PrincipalEntityIdentityReviewPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");
  if (!session.organizationMemberships.some((membership) => membership.role === "owner")) redirect("/");

  const packet = await readAtlasEntityIdentityReviewQueue();

  return (
    <main style={shellStyle}>
      <div style={pageStyle}>
        <header style={{ ...cardStyle, background: "#24251f", color: "#f8f4e8" }}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .7 }}>
            Atlas · Principal Governance · Identity
          </span>
          <h1 style={{ margin: "6px 0 0", fontSize: "clamp(30px,6vw,48px)", lineHeight: 1 }}>
            Review entity identity
          </h1>
          <p style={{ margin: "10px 0 0", maxWidth: 800, lineHeight: 1.55, opacity: .82 }}>
            Inspect Resolver evidence and make the human identity decision. This surface can approve or reject a recommendation through the governed adjudication membrane. It cannot mutate identity records directly and it cannot execute a canonical merge.
          </p>
          <nav style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 16 }}>
            <Link href="/principal" style={{ color: "inherit", fontWeight: 800 }}>← Principal</Link>
          </nav>
        </header>

        <section style={cardStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <strong>{packet.pendingCount} pending identity {packet.pendingCount === 1 ? "decision" : "decisions"}</strong>
            <span style={{ fontSize: 12, fontWeight: 800, opacity: .58 }}>Contract {packet.contractVersion}</span>
          </div>
          <p style={{ margin: "7px 0 0", lineHeight: 1.55, opacity: .74 }}>
            The reviewer is derived from the signed-in Principal session. The browser cannot supply reviewer provenance or substitute a different recommended target. Merge approval remains fenced by complete hard-veto evidence and always remains separate from merge execution.
          </p>
        </section>

        <EntityIdentityReviewClient packet={packet} />
      </div>
    </main>
  );
}
