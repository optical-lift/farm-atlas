import Link from "next/link";
import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

export default async function AtlasMorePage() {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const canManage = session.memberships.some((membership) => membership.role === "owner" || membership.role === "manager");
  const isFarmOwner = session.memberships.some((membership) => membership.role === "owner");
  const destinations = [
    { label: "Zone Registry", detail: "Beds, rooms, gardens and every canonical farm place", href: "/zones" },
    { label: "Bell", detail: "Future gaps, handoffs and meaningful farm movement", href: "/bell" },
    { label: "Projects", detail: "Builds, venue work and multi-step initiatives", href: "/projects" },
    { label: "Production", detail: "Crop cycles and production state", href: "/production" },
    { label: "Seed inventory", detail: "Verified counts, freshness and crop commitments", href: "/inventory/seeds" },
    ...(canManage ? [
      { label: "Farm day", detail: "Big picture of today’s assigned work by person", href: "/manage/day" },
      { label: "Tomorrow preflight", detail: "Review each person's real day, overload and held work", href: "/tomorrow" },
      { label: "People + roles", detail: "Farm membership and authority", href: "/owner/members" },
      { label: "Farm management", detail: "Blockers, assignment and schedule risk", href: "/manage" },
    ] : []),
    ...(isFarmOwner ? [
      { label: "Rulebook + Clock", detail: "Farm rhythms, evidence and Owner controls", href: "/manage/rhythms" },
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
          <span aria-hidden="true" />
          <Link href="/" className="atlas-note-plus" aria-label="Return home">×</Link>
        </header>

        <section className="atlas-more-page__intro">
          <span>Elsewhere in Atlas</span>
          <h1>Controls and deeper views</h1>
          <p>Open the parts of Atlas that do not need a permanent place in the app dock.</p>
        </section>

        <div id="atlas-more-account-slot" />
        {canManage ? <div id="atlas-more-work-alongside-slot" /> : null}

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

        <form className="atlas-more-page__logout" action="/api/atlas/auth/logout" method="post">
          <button type="submit">Log out</button>
        </form>
      </section>
    </main>
  );
}