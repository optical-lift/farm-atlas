import type { Metadata } from "next";
import Link from "next/link";

import styles from "../welcome/sales-page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start Atlas",
  description: "Choose where Atlas should begin mapping your connected life and responsibilities.",
};

export default function AtlasStartPage() {
  return (
    <main className={styles.page} data-atlas-sales-page="true">
      <div className={styles.shell}>
        <nav className={styles.brandBar} aria-label="Atlas">
          <Link className={styles.brand} href="/welcome">ATLAS</Link>
          <div className={styles.brandActions}>
            <Link href="/login">Sign in</Link>
          </div>
        </nav>

        <section className={styles.startContent}>
          <div className={styles.startIntro}>
            <p className={styles.eyebrow}>Start Atlas</p>
            <h1>What are you bringing into Atlas first?</h1>
            <p className={styles.startLead}>
              Atlas is personalized around the person using it. An organization can also have its own shared
              map. When the two connect, Atlas can understand both what the organization is trying to
              accomplish and what that means for your responsibilities and your day.
            </p>
          </div>

          <div className={styles.startChoices}>
            <div className={styles.startChoice}>
              <p className={styles.choiceLabel}>Myself</p>
              <p>
                Begin with your own responsibilities, goals, relationships, work, household, projects, and
                daily life. Organizations can be connected afterward without becoming your identity.
              </p>
              <Link className={styles.startPrimary} href="/start/personal">Start with me</Link>
            </div>

            <div className={styles.startChoice}>
              <p className={styles.choiceLabel}>An organization</p>
              <p>
                Begin the shared operating map for a company, team, or group. Your own role can be
                connected afterward when that relationship is actually known.
              </p>
              <Link className={styles.startSecondary} href="/start/organization">Start with an organization</Link>
            </div>
          </div>

          <p className={styles.startNote}>
            This only chooses where onboarding begins. It is not a choice between two different Atlas products.
          </p>
        </section>
      </div>
    </main>
  );
}
