import Link from "next/link";
import { redirect } from "next/navigation";

import { readAtlasPrincipalSelfContext } from "@/lib/atlas/principal-self-context";
import { getAtlasSession } from "@/lib/atlas/session";

import PrincipalAuthoringClient from "./PrincipalAuthoringClient";

export const dynamic = "force-dynamic";

const shellStyle = {
  minHeight: "100vh",
  background: "#f5f1e8",
  color: "#262626",
  padding: "24px 16px 48px",
} as const;

const pageStyle = {
  width: "min(980px, 100%)",
  margin: "0 auto",
  display: "grid",
  gap: 16,
} as const;

const cardStyle = {
  border: "1px solid rgba(38, 38, 38, 0.12)",
  borderRadius: 18,
  background: "rgba(255,255,255,.76)",
  padding: 18,
  boxShadow: "0 10px 32px rgba(47,43,31,.045)",
} as const;

export default async function AtlasPrincipalAuthorPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");
  if (!session.personEntityId || !session.personalAtlasId) redirect("/onboarding");

  const context = await readAtlasPrincipalSelfContext();
  if (context.state !== "ready" || !context.principal) redirect("/principal");

  return (
    <main style={shellStyle}>
      <div style={pageStyle}>
        <header style={{ ...cardStyle, background: "#24251f", color: "#f8f4e8" }}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .7 }}>Atlas · Personal Atlas · Portfolio Office</span>
          <h1 style={{ margin: "6px 0 0", fontSize: "clamp(30px, 6vw, 48px)", lineHeight: 1 }}>Teach Atlas what you intend to carry</h1>
          <p style={{ margin: "10px 0 0", maxWidth: 720, lineHeight: 1.55, opacity: .8 }}>
            This is where your portfolio-governance model is stated rather than inferred. Author obligations before urgency arrives, and make each portfolio thesis explicit enough for Atlas to protect the future without guessing. These records are your Personal Atlas projection, not automatic institutional Reality.
          </p>
          <nav style={{ marginTop: 16 }}>
            <Link href="/principal" style={{ color: "inherit", fontWeight: 800 }}>← Back to Principal</Link>
          </nav>
        </header>

        <section style={cardStyle}>
          <strong>What belongs here</strong>
          <p style={{ margin: "7px 0 0", lineHeight: 1.55, opacity: .74 }}>
            Governance obligations preserve thinking, deciding, planning, reviewing, creating, communicating, approving, and funding that you intend to carry personally. Portfolio theses preserve why a unit deserves time, attention, or capital inside your planning model. Neither record creates institutional authority by itself.
          </p>
          <p style={{ margin: "9px 0 0", lineHeight: 1.55, opacity: .64 }}>
            Planning examples: Plan Elm 2027 crop rotation · Design Waiting Room overwintering landscape · Prepare Farm 3 acquisition thesis.
          </p>
        </section>

        <PrincipalAuthoringClient units={context.portfolioUnits ?? []} />
      </div>
    </main>
  );
}
