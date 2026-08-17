import Link from "next/link";
import { redirect } from "next/navigation";

import { readAtlasPrincipalSelfContext } from "@/lib/atlas/principal-self-context";
import { getAtlasSession } from "@/lib/atlas/session";

import PrincipalOfficeAuthoringClient from "./PrincipalOfficeAuthoringClient";

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

export default async function AtlasPrincipalOfficeAuthorPage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");
  if (!session.organizationMemberships.some((membership) => membership.role === "owner")) redirect("/");

  const context = await readAtlasPrincipalSelfContext();
  if (context.state !== "ready" || !context.principal) redirect("/principal");

  return (
    <main style={shellStyle}>
      <div style={pageStyle}>
        <header style={{ ...cardStyle, background: "#24251f", color: "#f8f4e8" }}>
          <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".13em", textTransform: "uppercase", opacity: .7 }}>Atlas · Principal Office Authoring</span>
          <h1 style={{ margin: "6px 0 0", fontSize: "clamp(30px, 6vw, 48px)", lineHeight: 1 }}>Author the institution above the task list</h1>
          <p style={{ margin: "10px 0 0", maxWidth: 760, lineHeight: 1.55, opacity: .8 }}>
            Protect quiet attention, name durable functions, define Great Game scoreboards, and state real capital claims or investment opportunities. These records let Atlas remember the institution without translating ordinary unfinished work into Principal urgency.
          </p>
          <nav style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 16 }}>
            <Link href="/principal" style={{ color: "inherit", fontWeight: 800 }}>← Principal</Link>
            <Link href="/principal/author" style={{ color: "inherit", fontWeight: 800 }}>Owner obligations &amp; theses</Link>
          </nav>
        </header>

        <section style={cardStyle}>
          <strong>These are separate stewardship instruments</strong>
          <p style={{ margin: "7px 0 0", lineHeight: 1.55, opacity: .74 }}>
            Attention says what must not disappear. A durable function says what work exists regardless of who carries it. A Great Game scorecard says whether a function or unit is healthy without exposing every task. House Position distinguishes requested capital from investment opportunity and preserves readiness rather than treating every possible spend as the same thing.
          </p>
        </section>

        <PrincipalOfficeAuthoringClient
          units={context.portfolioUnits ?? []}
          functions={context.principalOffice?.operatingFunctions ?? []}
        />
      </div>
    </main>
  );
}
