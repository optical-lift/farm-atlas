import type { Metadata } from "next";
import Link from "next/link";

import journalStyles from "./hero-photo.module.css";
import styles from "./sales-page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atlas — connective intelligence for real life",
  description:
    "Atlas maps the systems, people, organizations, responsibilities, and goals that make up real life and connects what changes across them.",
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

const notebookPhoto =
  "https://images.pexels.com/photos/17219305/pexels-photo-17219305/free-photo-of-open-notebook-with-blank-pages-on-white-background.png?auto=compress&cs=tinysrgb&w=1260";

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

        <section className={`${styles.hero} ${journalStyles.heroLayout}`}>
          <div className={`${styles.heroCopy} ${journalStyles.heroCopyWide}`}>
            <p className={styles.eyebrow}>Connective intelligence for real life</p>
            <h1>Atlas puts it back together.</h1>
            <p className={styles.heroLead}>Your life is already in there. It just lives in pieces.</p>
            <p className={styles.heroThesis}>
              Work. Home. Money. People. Projects. Messages. Plans. Organizations. Atlas connects what
              is happening across the places you belong and carries what changes into the day you
              actually have to live.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/start">Start Atlas</Link>
            </div>
          </div>

          <figure
            className={`${styles.heroInstrument} ${journalStyles.heroJournal}`}
            aria-label="A real open notebook showing one working parent's future log, monthly log, and daily log"
          >
            <div className={journalStyles.photoStage}>
              <img
                className={journalStyles.photo}
                src={notebookPhoto}
                alt="An open physical notebook on a white surface"
                loading="eager"
              />
              <div className={journalStyles.journalInk} aria-hidden="true">
                <section className={journalStyles.leftInkPage}>
                  <div className={journalStyles.logBlock}>
                    <strong>FUTURE LOG</strong>
                    <span>SEP</span>
                    <p>3 · dentist 2:30</p>
                    <p>7 · school closed</p>
                    <p>15 · quarterly review</p>
                    <span>OCT</span>
                    <p>2 · parent-teacher 4</p>
                    <p>18 · school fundraiser</p>
                  </div>
                  <div className={journalStyles.logBlock}>
                    <strong>SEPTEMBER</strong>
                    <p>1 T · review notes</p>
                    <p>2 W · groceries</p>
                    <p>3 T · team 10:30 / dentist 2:30</p>
                    <p>4 F · school forms</p>
                  </div>
                </section>

                <section className={journalStyles.rightInkPage}>
                  <div className={`${journalStyles.logBlock} ${journalStyles.dailyLog}`}>
                    <strong>DAILY LOG · THU 3</strong>
                    <p><b>×</b> lunches packed</p>
                    <p><b>•</b> finish review notes</p>
                    <p><b>○</b> team meeting · 10:30</p>
                    <p><b>○</b> dentist · 2:30</p>
                    <p><b>•</b> school pickup · 3:15</p>
                    <p><b>•</b> groceries on way home</p>
                    <p><b>–</b> dinner = leftovers</p>
                    <p><b>›</b> groceries → Fri</p>
                  </div>
                </section>
              </div>
            </div>
            <figcaption className={journalStyles.credit}>
              Physical notebook photograph with a working-parent rapid-log example.
            </figcaption>
          </figure>
        </section>

        <section className={styles.compatibility} aria-label="Compatible systems">
          <p className={styles.compatibilityLabel}>Works with the systems already carrying your life and work</p>
          <div className={styles.integrationList}>
            {compatibleSystems.map((system) => <span key={system}>{system}</span>)}
          </div>
          <p className={styles.compatibilityNote}>
            Keep the tools that already do their jobs. Atlas connects what each one knows through official APIs.
          </p>
        </section>

        <section className={`${styles.section} ${styles.connectionSection}`}>
          <div className={styles.connectionCopy}>
            <p className={styles.eyebrow}>The connective layer</p>
            <h2>The parts of your life know things about each other. They just can&apos;t see each other.</h2>
            <strong>
              Atlas maps the circles you belong to and understands what a change in one of them means for the others.
            </strong>
            <p>
              Your employer has goals. Your household has needs. Your calendar has limits. Your relationships create
              responsibilities. Atlas connects those realities around the person who has to live them.
            </p>
          </div>

          <div className={styles.continuityVisual} aria-label="One working parent's connected day">
            <div className={styles.signalColumn}>
              <div className={styles.signalBubble}>
                <span>WORK CALENDAR</span>
                <p>Team meeting moved to 11:30.</p>
              </div>
              <div className={styles.signalBubble}>
                <span>PERSONAL CALENDAR</span>
                <p>Dentist · 2:30.</p>
              </div>
              <div className={styles.signalBubble}>
                <span>SCHOOL</span>
                <p>Pickup · 3:15.</p>
              </div>
            </div>
            <div className={styles.continuityCore}>
              <span>ATLAS</span>
              <i />
              <strong>connect</strong>
              <i />
            </div>
            <div className={styles.resultNote}>
              <span>YOUR DAY CHANGED</span>
              <strong>The meeting still fits.</strong>
              <p>Leave work by 2:05. You can make the dentist and school pickup without moving either.</p>
              <small>› groceries → tomorrow</small>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.mapSection}`}>
          <div className={styles.mapCopy}>
            <p className={styles.eyebrow}>Your map</p>
            <h2>Your Atlas starts with you. Then it maps outward.</h2>
            <p>
              Your Atlas is the map of what you are responsible for. Workplaces, businesses, households,
              teams, projects, and relationships are circles within that map. Some of those circles can also
              have shared Atlases of their own. Atlas connects your place in each one to the day you actually
              have to live.
            </p>
          </div>

          <div className={styles.circleMap} aria-label="A person connected to overlapping circles of responsibility">
            <span className={`${styles.circle} ${styles.workCircle}`}>WORK</span>
            <span className={`${styles.circle} ${styles.homeCircle}`}>HOUSEHOLD</span>
            <span className={`${styles.circle} ${styles.peopleCircle}`}>PEOPLE</span>
            <span className={`${styles.circle} ${styles.projectCircle}`}>PROJECTS</span>
            <span className={`${styles.circle} ${styles.orgCircle}`}>ORGANIZATIONS</span>
            <strong>YOU</strong>
          </div>
        </section>

        <section className={`${styles.section} ${styles.closingSection}`} id="start">
          <div className={styles.closingCopy}>
            <p className={styles.eyebrow}>One life. Many circles. One Atlas.</p>
            <h2>Bring the pieces together.</h2>
            <p>
              Atlas gives you connective intelligence across the work, people, organizations,
              responsibilities, systems, and goals that make up your real life.
            </p>
            <Link className={styles.primaryAction} href="/start">Start Atlas</Link>
            <small>
              Start with yourself or bring an organization with you. Atlas will guide the setup after you create your account.
            </small>
          </div>
        </section>
      </div>
    </main>
  );
}
