import type { Metadata } from "next";
import Link from "next/link";

import journalStyles from "./hero-photo.module.css";
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

        <section className={`${styles.hero} ${journalStyles.heroLayout}`}>
          <div className={`${styles.heroCopy} ${journalStyles.heroCopyWide}`}>
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

          <figure
            className={`${styles.heroInstrument} ${journalStyles.heroJournal}`}
            aria-label="A minimalist Bullet Journal Method-style company notebook"
          >
            <div className={journalStyles.book}>
              <section className={`${journalStyles.journalPage} ${journalStyles.leftPage}`}>
                <header className={journalStyles.pageHeader}>
                  <span>FUTURE LOG</span>
                  <span>08–10</span>
                </header>
                <div className={journalStyles.monthBlock}>
                  <strong>AUGUST</strong>
                  <p><span>•</span> Thursday delivery window</p>
                  <p><span>○</span> Team check-in · 10:30</p>
                </div>
                <div className={journalStyles.monthBlock}>
                  <strong>SEPTEMBER</strong>
                  <p><span>•</span> Fall purchasing review</p>
                  <p><span>•</span> Protect planning block</p>
                </div>
                <div className={journalStyles.monthBlock}>
                  <strong>OCTOBER</strong>
                  <p><span>–</span> Production window ahead</p>
                </div>
                <span className={journalStyles.pageNumber}>18</span>
              </section>

              <section className={`${journalStyles.journalPage} ${journalStyles.rightPage}`}>
                <header className={journalStyles.pageHeader}>
                  <span>DAILY LOG</span>
                  <span>31 SUN</span>
                </header>
                <div className={journalStyles.rapidLog}>
                  <p><span>×</span> North beds complete</p>
                  <p><span>•</span> Check Thursday route capacity</p>
                  <p><span>○</span> Delivery moved to 11</p>
                  <p><span>–</span> Thursday still fits</p>
                  <p><span>›</span> Review fall purchasing</p>
                </div>
                <div className={journalStyles.key}>
                  <span>• task</span>
                  <span>○ event</span>
                  <span>– note</span>
                  <span>× complete</span>
                  <span>› migrate</span>
                </div>
                <span className={journalStyles.pageNumber}>19</span>
              </section>
            </div>
            <figcaption className={journalStyles.credit}>
              A restrained rapid-logging journal inspired by the Ryder Carroll Bullet Journal Method.
            </figcaption>
          </figure>
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
