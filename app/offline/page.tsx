import Link from "next/link";

export default function AtlasOfflinePage() {
  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Offline</span>
          </Link>
          <span className="atlas-weather-line">Waiting for field signal</span>
          <span className="atlas-note-plus" aria-hidden="true">○</span>
        </header>

        <div className="atlas-pwa-offline-body">
          <section>
            <span>Signal dropped</span>
            <h1>Atlas is still here.</h1>
            <p>Return to a Home, Day, Bell, Place, or Project view you opened on this device before the connection dropped.</p>
            <div>
              <Link href="/">Home</Link>
              <Link href="/day">Day</Link>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
