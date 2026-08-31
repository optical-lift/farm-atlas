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
              Work. Home. Money. People. Projects. Messages. Plans. Organizations. Atlas connects the
              systems carrying those pieces and understands what a change in one means for the rest of your day.
            </p>
            <Link className={styles.primaryAction} href="/start">Start Atlas</Link>
          </div>

          <figure
            className={`${styles.heroInstrument} ${journalStyles.heroJournal}`}
            aria-label="An open notebook showing the future, monthly, and daily logs of one working parent"
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
                    <p>1 T · review notes / lunches</p>
                    <p>2 W · groceries / forms</p>
                    <p>3 T · team 10:30 / dentist 2:30</p>
                    <p>4 F · school forms / call Mom</p>
                    <p>5 S · laundry / soccer 9</p>
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
              One working parent&apos;s future log, monthly log, and daily log.
            </figcaption>
          </figure>
        </section>

        <section className={`${styles.section} ${styles.storySection}`}>
          <div className={styles.storyIntro}>
            <p className={styles.eyebrow}>One ordinary Thursday</p>
            <h2>Her day is already mapped. Then one thing changes.</h2>
            <p>
              The notebook says what she planned. Work, appointments, and school each know one part of the day.
              Atlas sees what the change means across all of them.
            </p>
          </div>

          <div className={styles.dayStory} aria-label="A working parent's Thursday before and after a work calendar change">
            <div className={styles.storyColumn}>
              <span>THE MORNING PLAN</span>
              <strong>10:30 team meeting</strong>
              <p>2:30 dentist</p>
              <p>3:15 school pickup</p>
              <p>Groceries on the way home</p>
            </div>
            <div className={`${styles.storyColumn} ${styles.changeColumn}`}>
              <span>WORK CHANGES</span>
              <strong>Meeting moved to 11:30.</strong>
              <p>Nothing else moved.</p>
            </div>
            <div className={`${styles.storyColumn} ${styles.atlasColumn}`}>
              <span>ATLAS</span>
              <strong>The meeting still fits.</strong>
              <p>Leave work by 2:05. Keep the dentist and school pickup.</p>
              <p className={styles.handwritten}>› groceries → Friday</p>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.mapSection}`}>
          <div className={styles.mapCopy}>
            <p className={styles.eyebrow}>Your Atlas</p>
            <h2>You are the center. Your circles are the map.</h2>
            <p>
              Your Atlas is personalized to the life you are responsible for. Work, household, people,
              business, projects, and organizations can each be mapped around you.
            </p>
            <p>
              An organization can also have its own shared Atlas. Yours understands where that organization&apos;s
              goals meet your role, your time, and everything else you carry.
            </p>
          </div>

          <div className={styles.circleField} aria-label="The circles Atlas can map around one person">
            <strong className={styles.youCard}>YOU</strong>
            <span>WORK</span>
            <span>HOUSEHOLD</span>
            <span>PEOPLE</span>
            <span>BUSINESS</span>
            <span>PROJECTS</span>
            <span>ORGANIZATIONS</span>
          </div>
        </section>

        <section className={styles.compatibility} aria-label="Compatible systems">
          <div>
            <p className={styles.eyebrow}>Connect what already knows your life</p>
            <p className={styles.compatibilityCopy}>
              Keep the tools that already do their jobs. Atlas connects what each one knows.
            </p>
          </div>
          <div className={styles.integrationList}>
            {compatibleSystems.map((system) => <span key={system}>{system}</span>)}
          </div>
        </section>

        <section className={styles.closingSection} id="start">
          <div className={styles.closingCopy}>
            <p className={styles.closingEyebrow}>One life. Many circles. One Atlas.</p>
            <h2>Bring the pieces together.</h2>
            <p>
              Create your account, choose where Atlas should begin, and start mapping the responsibilities,
              people, systems, and organizations that shape your day.
            </p>
            <Link className={styles.closingAction} href="/start">Start Atlas</Link>
            <small>Start with yourself or bring an organization with you. Atlas will guide the setup.</small>
          </div>
        </section>
      </div>
    </main>
  );
}
