import Link from "next/link";

import AskAtlasOwner from "../AskAtlasOwner";

export const dynamic = "force-dynamic";

export default function AskAtlasReconciliationPage() {
  return (
    <main className="atlas-owner-ask-page" data-atlas-owner-ask-page="true">
      <section className="atlas-owner-ask-page__sheet">
        <header className="atlas-owner-ask-page__chrome">
          <Link href="/owner" aria-label="Return to Today">←</Link>
          <div>
            <span>read atlas</span>
            <strong>Reality check</strong>
          </div>
          <small>design test</small>
        </header>

        <div className="atlas-owner-ask-page__body">
          <AskAtlasOwner />
        </div>

        <nav className="atlas-owner-ask-page__nav" aria-label="Ask Atlas navigation">
          <Link href="/owner">‹</Link>
          <Link href="/owner">today</Link>
          <span>ask</span>
          <Link href="/owner">›</Link>
        </nav>
      </section>
    </main>
  );
}
