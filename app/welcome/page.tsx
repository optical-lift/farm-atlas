import type { Metadata } from "next";
import Link from "next/link";
import { Nothing_You_Could_Do, Source_Sans_3 } from "next/font/google";

import styles from "./front-door.module.css";

export const dynamic = "force-dynamic";

const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--atlas-system-font" });
const humanHand = Nothing_You_Could_Do({ weight: "400", subsets: ["latin"], variable: "--atlas-human-font" });

export const metadata: Metadata = {
  title: "Atlas — the company, put back together",
  description:
    "Atlas connects the systems that know pieces of a company and turns them into one living operating model for the people responsible for it.",
};

const companySystems = [
  "Finance",
  "Customers",
  "Inventory",
  "Payroll",
  "Projects",
  "Training",
  "Messages",
  "Files",
  "Forecasts",
];

const humanViews = [
  ["Owner", "Two decisions require you."],
  ["Manager", "Thursday needs coverage."],
  ["Sales", "Call Acme today."],
  ["Worker", "Pack order 1842."],
];

export default function AtlasWelcomePage() {
  return (
    <main className={`${styles.page} ${sourceSans.variable} ${humanHand.variable}`}>
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
            <p className={styles.eyebrow}>A living operating system for a real company</p>
            <h1>The company already exists. Atlas puts it back together.</h1>
            <p className={styles.heroLead}>
              Finance knows the money. CRM knows the customers. Inventory knows the stock. Email knows the
              conversations. Payroll knows the people. Your team is still carrying the whole company in
              their heads.
            </p>
            <p className={styles.heroThesis}>
              Atlas connects those fragments into one living model of the organization—and gives each
              person the part of that reality they actually need.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/start/organization">Start Organization Atlas</Link>
              <Link className={styles.textAction} href="#personal">Personal Atlas →</Link>
            </div>
          </div>

          <div className={styles.heroInstrument} aria-label="Conceptual Atlas company model">
            <div className={styles.instrumentHalo} />
            <div className={styles.sourceRail} aria-hidden="true">
              <span>FINANCE</span>
              <span>CRM</span>
              <span>INVENTORY</span>
              <span>MESSAGES</span>
              <span>FILES</span>
            </div>
            <div className={styles.notebook}>
              <div className={styles.notebookHeader}>
                <span>COMPANY / LIVE MODEL</span>
                <span>08.31.26</span>
              </div>
              <div className={styles.notebookRule} />
              <p className={styles.handLine}>Two decisions require you.</p>
              <div className={styles.bulletLine}>
                <span>●</span>
                <div>
                  <strong>Protect Thursday delivery capacity.</strong>
                  <small>Sales commitments now exceed the current route window.</small>
                </div>
              </div>
              <div className={styles.bulletLine}>
                <span>○</span>
                <div>
                  <strong>Approve fall purchasing.</strong>
                  <small>Cash plan remains inside the protected operating floor.</small>
                </div>
              </div>
              <div className={styles.askStrip}>
                <span>ASK ATLAS</span>
                <p>What changed while I was gone?</p>
              </div>
            </div>
            <div className={styles.outputRail} aria-hidden="true">
              <span>OWNER</span>
              <span>MANAGER</span>
              <span>SALES</span>
              <span>WORKER</span>
            </div>
          </div>
        </section>

        <section className={styles.statementBand}>
          <p>De-fragmenting the broken pieces.</p>
          <p>Unifying thought and action.</p>
          <p>Showing up when people forget to.</p>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>The problem is not missing software</p>
            <h2>Your company is already in there. It just lives in pieces.</h2>
          </div>
          <div className={styles.fractureGrid}>
            <div className={styles.systemList}>
              {companySystems.map((system) => (
                <div className={styles.systemRow} key={system}>
                  <span className={styles.openMark}>○</span>
                  <span>{system}</span>
                </div>
              ))}
            </div>
            <div className={styles.fractureCopy}>
              <p>
                Growing companies accumulate excellent specialist systems. Each one can be authoritative
                inside its own boundary and still leave the organization fragmented as a whole.
              </p>
              <p>
                The gaps are usually filled by people: remembering what the software did not connect,
                translating between departments, carrying context into meetings, noticing that one number
                somewhere changes what another person should do next.
              </p>
              <strong>Atlas makes that connective intelligence part of the company instead of leaving it in somebody&apos;s head.</strong>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.modelSection}`}>
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>One company. Many lawful views.</p>
            <h2>Atlas holds the whole. People receive what has earned their attention.</h2>
          </div>

          <div className={styles.modelDiagram}>
            <div className={styles.modelSources}>
              {companySystems.slice(0, 7).map((system) => <span key={system}>{system}</span>)}
            </div>
            <div className={styles.atlasCore}>
              <span className={styles.coreLabel}>ATLAS</span>
              <strong>Company state · live</strong>
              <div className={styles.coreRows}>
                <span><b>Revenue</b><em>projected</em></span>
                <span><b>Cash</b><em>protected</em></span>
                <span><b>Inventory</b><em>constrained</em></span>
                <span><b>Sales</b><em>committed</em></span>
                <span><b>People</b><em>in motion</em></span>
              </div>
            </div>
            <div className={styles.humanOutputs}>
              {humanViews.map(([role, line], index) => (
                <div className={styles.humanOutput} key={role}>
                  <span>{role}</span>
                  <p className={index === 0 ? styles.handLineSmall : undefined}>{line}</p>
                </div>
              ))}
            </div>
          </div>

          <p className={styles.modelFootnote}>
            The point is not to give everyone a larger dashboard. The point is to let the company reason at
            company scale and communicate at human scale.
          </p>
        </section>

        <section className={`${styles.section} ${styles.ambientSection}`}>
          <div className={styles.ambientCopy}>
            <p className={styles.eyebrow}>Atlas happens around the work</p>
            <h2>You should not have to stop living in order to update your software.</h2>
            <p>
              A promise appears in a text. A customer changes an order by email. A worker finishes something
              in the field. A meeting changes the plan. A file contains the policy nobody remembers to check.
            </p>
            <p>
              Atlas is designed to receive those signals from the systems already carrying the company,
              reconcile them into governed truth, and bring the consequence to the person who needs it.
            </p>
            <p className={styles.ambientThesis}>
              Atlas does not ask people to become more like software. It makes software better at supporting people.
            </p>
          </div>

          <div className={styles.continuityVisual} aria-label="Conceptual Atlas continuity flow">
            <div className={styles.signalColumn}>
              <div className={styles.signalBubble}><span>MESSAGE</span><p>I finished the north beds and moved the trays.</p></div>
              <div className={styles.signalBubble}><span>EMAIL</span><p>Can we move Thursday&apos;s delivery to 11?</p></div>
              <div className={styles.signalBubble}><span>CALENDAR</span><p>Route window · 10:30–12:00</p></div>
            </div>
            <div className={styles.continuityCore}>
              <span>ATLAS CONTINUITY</span>
              <i />
              <strong>reconcile</strong>
              <i />
            </div>
            <div className={styles.resultNote}>
              <span>NOW TRUE</span>
              <p className={styles.handLineSmall}>Thursday still fits. North beds are complete.</p>
              <small>Downstream work and the route plan can move without another round of re-entry.</small>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.definitionSection}`}>
          <p className={styles.eyebrow}>The product</p>
          <h2>Atlas is the intelligence layer between reality and the people responsible for it.</h2>
          <div className={styles.definitionGrid}>
            <div><span>01</span><strong>Remember</strong><p>Keep promises, evidence, history, obligations, and operating knowledge from falling through the cracks.</p></div>
            <div><span>02</span><strong>Understand</strong><p>Connect money, inventory, customers, people, work, time, projections, and source evidence without flattening their custody.</p></div>
            <div><span>03</span><strong>Compose</strong><p>Turn company-scale truth into the right decision, warning, task, training move, conversation, or protected future for each person.</p></div>
            <div><span>04</span><strong>Continue</strong><p>Carry reality forward as it changes so the organization does not have to reconstruct itself every morning.</p></div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.entrySection}`} id="personal">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>Start with the thing Atlas is being asked to hold</p>
            <h2>What is getting an Atlas?</h2>
          </div>

          <div className={styles.entryChoices}>
            <Link className={styles.entryChoice} href="/start/personal">
              <div>
                <span className={styles.choiceNumber}>01</span>
                <p className={styles.eyebrow}>For one person</p>
                <h3>Personal Atlas</h3>
                <p>
                  One human life across work, home, health, projects, relationships, time, and the
                  organizations connected to it—without reducing the person to any one role.
                </p>
              </div>
              <strong>Begin Personal Atlas →</strong>
            </Link>

            <Link className={styles.entryChoice} href="/start/organization">
              <div>
                <span className={styles.choiceNumber}>02</span>
                <p className={styles.eyebrow}>For a company or group</p>
                <h3>Organization Atlas</h3>
                <p>
                  An independent company, nonprofit, farm, practice, or team with its own identity,
                  sources, operating memory, intelligence, and custody—even before its people join Atlas.
                </p>
              </div>
              <strong>Begin Organization Atlas →</strong>
            </Link>
          </div>
        </section>

        <section className={styles.closing}>
          <p className={styles.eyebrow}>Atlas</p>
          <h2>Make the company whole enough to think with its people.</h2>
          <p>Then let the people remain whole enough to be more than the company.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/start/organization">Start Organization Atlas</Link>
            <Link className={styles.textAction} href="/login">Sign in →</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
