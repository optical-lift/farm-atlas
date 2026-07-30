import Link from "next/link";
import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

export default async function AtlasMorePage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const canManage = session.memberships.some((membership) => membership.role === "owner" || membership.role === "manager");
  const destinations = [
    { label: "Bell", detail: "Future gaps, handoffs and meaningful farm movement", href: "/bell" },
    { label: "Production", detail: "Crop cycles and production state", href: "/production" },
    ...(canManage ? [
      { label: "People + roles", detail: "Farm membership and authority", href: "/owner/members" },
      { label: "Farm management", detail: "Blockers, assignment and schedule risk", href: "/manage" },
    ] : []),
    { label: "Atlas app", detail: "Farm Alerts, installation and connected devices", href: "/install" },
    { label: "Account", detail: "Password and sign-in settings", href: "/settings/password" },
  ];

  return (
    <main className="atlas-phone-shell atlas-more-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-more-page">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">More</span>
          </Link>
          <span className="atlas-weather-line">Other routes</span>
          <Link href="/" className="atlas-note-plus" aria-label="Return home">×</Link>
        </header>

        <section className="atlas-more-page__intro">
          <span>Elsewhere in Atlas</span>
          <h1>Controls and deeper views</h1>
          <p>Atlas itself is the farm record. These routes open particular parts of it rather than sending history to a separate dumping ground.</p>
        </section>

        <nav className="atlas-more-page__list" aria-label="More Atlas destinations">
          {destinations.map((destination) => (
            <Link key={destination.href} href={destination.href}>
              <div>
                <strong>{destination.label}</strong>
                <span>{destination.detail}</span>
              </div>
              <b aria-hidden="true">›</b>
            </Link>
          ))}
        </nav>
      </section>
    </main>
  );
}
