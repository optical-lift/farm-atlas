import type { Metadata } from "next";
import Link from "next/link";

import styles from "./sales-page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atlas — connective intelligence for real life",
  description:
    "Atlas connects the people, responsibilities, systems, and organizations that shape your real life.",
};

export default function AtlasWelcomePage() {
  return (
    <main className={styles.page} data-atlas-sales-page="true">
      <div className={styles.shell}>
        <nav className={styles.brandBar} aria-label="Atlas">
          <Link className={styles.brand} href="/welcome">ATLAS</Link>
          <div className={styles.brandActions}>
            <Link href="/login">Sign in</Link>
            <Link className={styles.brandCta} href="/start">Start Atlas</Link>
          </div>
        </nav>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>Connective intelligence for real life</p>
          <h1>Atlas puts it back together.</h1>
          <p className={styles.lead}>Your life is already in there. It just lives in pieces.</p>
          <p className={styles.thesis}>
            Work. Home. Money. People. Projects. Messages. Plans. Organizations. Atlas connects the pieces
            and carries what changes into the day you actually have to live.
          </p>
          <p className={styles.explanation}>
            Your Atlas is personalized around the life you are responsible for. Work, household, people,
            business, projects, and organizations can all be mapped around you. An organization can have its
            own shared Atlas; yours understands where its goals meet your role, your time, and everything else
            you carry.
          </p>
          <p className={styles.tagline}>One life. Many circles. One Atlas.</p>
          <Link className={styles.primaryAction} href="/start">Start Atlas</Link>
        </section>
      </div>
    </main>
  );
}
