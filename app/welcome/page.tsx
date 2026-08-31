import type { Metadata } from "next";
import Link from "next/link";

import styles from "./front-door.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atlas",
  description: "Choose Personal Atlas or Organization Atlas and begin from the right custody root.",
};

export default function AtlasWelcomePage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Atlas</p>
          <h1>What is getting an Atlas?</h1>
          <p>
            Start with the thing Atlas is being asked to hold. A person and an organization can be
            related without becoming the same account.
          </p>
        </header>

        <section className={styles.choices} aria-label="Choose an Atlas">
          <Link className={styles.card} href="/start/personal">
            <div>
              <p className={styles.eyebrow}>For one person</p>
              <h2>Personal Atlas</h2>
              <p>
                One human life across work, home, health, projects, relationships, and the organizations
                you belong to. Your roles can meet here without being collapsed into one company account.
              </p>
            </div>
            <span className={styles.cardAction}>Start a Personal Atlas →</span>
          </Link>

          <Link className={styles.card} href="/start/organization">
            <div>
              <p className={styles.eyebrow}>For a company or group</p>
              <h2>Organization Atlas</h2>
              <p>
                A company, nonprofit, farm, practice, team, or other organization gets its own identity,
                sources, history, and custody—even before any owner or employee is added as an Atlas member.
              </p>
            </div>
            <span className={styles.cardAction}>Start an Organization Atlas →</span>
          </Link>
        </section>

        <footer className={styles.footer}>
          <span>Already use Atlas?</span>
          <Link href="/login">Sign in</Link>
        </footer>
      </div>
    </main>
  );
}
