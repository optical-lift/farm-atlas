import Link from "next/link";

import AtlasPwaSetupPanel from "@/components/atlas/pwa/AtlasPwaSetup";

export default function AtlasInstallPage() {
  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">App</span>
          </Link>
          <span className="atlas-weather-line">Home Screen · offline shell · lockscreen delivery</span>
          <Link href="/bell" className="atlas-note-plus" aria-label="Open Bell">⌁</Link>
        </header>

        <div className="atlas-pwa-page-body">
          <section className="atlas-pwa-page-intro">
            <span>Atlas on this device</span>
            <h1>Let Atlas carry the workday.</h1>
            <p>Install Atlas from Safari so assigned work reaches this lockscreen when it becomes actionable. Required work delivery stays on; optional reminder types remain yours to choose.</p>
          </section>

          <AtlasPwaSetupPanel />

          <footer className="atlas-pwa-footer">
            <Link href="/">Journal cover</Link>
            <Link href="/bell">Bell</Link>
          </footer>
        </div>
      </section>
    </main>
  );
}
