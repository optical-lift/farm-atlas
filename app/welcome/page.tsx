import type { Metadata } from "next";
import Link from "next/link";

import styles from "./sales-page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atlas — put the company back together",
  description:
    "Atlas connects the systems that already know pieces of a company and carries what changes to the people who need to know.",
};

const compatibleSystems = [
  "Google Workspace",
  "Microsoft 365",
  "QuickBooks",
  "Slack",
  "Shopify",
  "Stripe",
  "Salesforce",
  "HubSpot",
  "Square",
  "Dropbox",
];

export default function AtlasWelcomePage() {
  return (
    <main className={styles.page} data-atlas-sales-page="true">
      <div className={styles.shell}>
        <nav className={styles.brandBar} aria-label="Atlas">
          <Link className={styles.brand} href="/welcome">ATLAS</Link>
          <div className={styles.brandActions}>
            <Link href="/login">Sign in</Link>
            <Link className={styles.brandCta} href="/start/organization">Start Atlas</Link>
          </div>
        </nav>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Connective intelligence for a real company</p>
            <h1>Atlas puts it back together.</h1>
            <p className={styles.heroLead}>Your company is already in there. It just lives in pieces.</p>
            <p className={styles.heroThesis}>
              Finance. Customers. Inventory. People. Projects. Messages. Plans. Atlas connects the pieces
              and carries what changes to the people who need to know.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/start/organization">Start Organization Atlas</Link>
              <Link className={styles.textAction} href="#start">Personal Atlas →</Link>
            </div>
          </div>

          <div className={styles.heroInstrument} aria-label="A company Atlas shown as a working notebook">
            <article className={styles.notebook}>
              <header className={styles.notebookHeader}>
                <span>COMPANY / LIVE MODEL</span>
                <span>08.31.26</span>
              </header>
              <div className={styles.notebookRule} />

              <div className={styles.taskLine}>
                <span aria-hidden="true">•</span>
                <div>
                  <strong>check whether Thursday deliveries still fit</strong>
                  <small>sales commitments · route capacity</small>
                </div>
              </div>
              <div className={styles.taskLine}>
                <span aria-hidden="true">○</span>
                <div>
                  <strong>review fall purchasing before Friday</strong>
                  <small>cash · purchasing</small>
                </div>
              </div>

              <div className={styles.askStrip}>
                <span>ASK ATLAS</span>
                <p>What changed while I was gone?</p>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.compatibility} aria-label="Compatible systems">
          <p className={styles.compatibilityLabel}>Works with the systems your company already uses</p>
          <div className={styles.integrationList}>
            {compatibleSystems.map((system) => <span key={system}>{system}</span>)}
          </div>
          <p className={styles.compatibilityNote}>Keep the specialist software. Atlas connects what each system knows through official APIs.</p>
        </section>

        <section className={`${styles.section} ${styles.connectionSection}`}>
          <div className={styles.connectionCopy}>
            <p className={styles.eyebrow}>The connective layer</p>
            <h2>Your software already knows the company in pieces.</h2>
            <strong>Atlas makes that connective intelligence part of the company instead of leaving it in somebody&apos;s head.</strong>
            <p>
              Atlas is designed to receive those signals from the systems already carrying the company,
              reconcile them into governed truth, and bring the consequence to the person who needs it.
            </p>
          </div>

          <div className={styles.continuityVisual} aria-label="Signals becoming company truth through Atlas">
            <div className={styles.signalColumn}>
              <div className={styles.signalBubble}><span>MESSAGE</span><p>I finished the north beds and moved the trays.</p></div>
              <div className={styles.signalBubble}><span>EMAIL</span><p>Can we move Thursday&apos;s delivery to 11?</p></div>
              <div className={styles.signalBubble}><span>CALENDAR</span><p>Route window · 10:30–12:00</p></div>
            </div>
            <div className={styles.continuityCore}>
              <span>ATLAS</span>
              <i />
              <strong>reconcile</strong>
              <i />
            </div>
            <div className={styles.resultNote}>
              <span>NOW TRUE</span>
              <strong>Thursday still fits.</strong>
              <p>North beds are complete. The plan can move without another round of re-entry.</p>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.entrySection}`} id="start">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>Ready to map out your Atlas?</p>
            <h2>Start where you are.</h2>
          </div>

          <div className={styles.entryChoices}>
            <Link className={styles.entryChoice} href="/start/personal">
              <div>
                <span className={styles.choiceNumber}>01</span>
                <p className={styles.eyebrow}>For a person</p>
                <h3>Personal Atlas</h3>
                <p>One human life across work, home, health, projects, relationships, time, and organizations.</p>
              </div>
              <strong>Begin Personal Atlas →</strong>
            </Link>

            <Link className={styles.entryChoice} href="/start/organization">
              <div>
                <span className={styles.choiceNumber}>02</span>
                <p className={styles.eyebrow}>For a company or group</p>
                <h3>Organization Atlas</h3>
                <p>An independent organization with its own sources, operating memory, intelligence, and custody.</p>
              </div>
              <strong>Begin Organization Atlas →</strong>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
