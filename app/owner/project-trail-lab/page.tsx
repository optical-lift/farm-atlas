import Link from "next/link";

import styles from "./project-trail-lab.module.css";

type TrailState = "done" | "now" | "locked";

type TrailStep = {
  label: string;
  detail: string;
  state: TrailState;
};

type Relation = {
  label: string;
  kind: string;
};

function ProjectTrail({ label, steps }: { label: string; steps: TrailStep[] }) {
  return (
    <div className={styles.trail} aria-label={label}>
      {steps.map((step) => (
        <div
          key={`${step.label}-${step.detail}`}
          className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLocked}
        >
          <span className={styles.trailDot} aria-hidden="true" />
          <strong>{step.label}</strong>
          <small>{step.detail}</small>
        </div>
      ))}
    </div>
  );
}

function RelationChips({ relations }: { relations: Relation[] }) {
  return (
    <div className={styles.relationChips}>
      {relations.map((relation) => (
        <div key={`${relation.kind}-${relation.label}`}>
          <small>{relation.kind}</small>
          <strong>{relation.label}</strong>
        </div>
      ))}
    </div>
  );
}

function EntryRefreshSpecimen() {
  const steps: TrailStep[] = [
    { label: "Repair", detail: "door fit · done", state: "done" },
    { label: "Paint purple", detail: "current move", state: "now" },
    { label: "Café lights", detail: "after paint", state: "locked" },
    { label: "Signage", detail: "after lights", state: "locked" },
    { label: "Final check", detail: "destination proof", state: "locked" },
  ];

  return (
    <article className={styles.projectCard}>
      <header className={styles.projectHeader}>
        <div className={styles.kickerRow}>
          <span>Project</span>
          <small>destination trail specimen</small>
        </div>
        <h2>Entry Refresh</h2>
        <div className={styles.destination}>
          <span>Destination</span>
          <strong>Entry and adjoining rooms visually finished and guest-ready</strong>
        </div>
      </header>

      <ProjectTrail label="Entry Refresh project trail" steps={steps} />

      <section className={styles.realitySection}>
        <div className={styles.sectionHeading}>
          <span>Current reality</span>
          <small>what is true now</small>
        </div>
        <div className={styles.realityGrid}>
          <div><span className={styles.evidenceDot} aria-hidden="true" /><strong>Door fit repaired</strong><small>evidence behind us</small></div>
          <div><span className={styles.liveDot} aria-hidden="true" /><strong>Door finish pending</strong><small>active state change</small></div>
          <div><span className={styles.lockedDot} aria-hidden="true" /><strong>Lights + signage waiting</strong><small>downstream</small></div>
        </div>
      </section>

      <section className={styles.activeMove}>
        <div className={styles.moveHeading}>
          <div>
            <span>Active move · Venue</span>
            <h3>Paint doors purple</h3>
          </div>
          <b>Ready</b>
        </div>

        <div className={styles.moveColumns}>
          <div className={styles.moveGroup}>
            <span>Objects</span>
            <div className={styles.simpleRows}>
              <strong>Entry room door</strong>
              <strong>Library door</strong>
            </div>
          </div>
          <div className={styles.moveGroup}>
            <span>Resources</span>
            <div className={styles.resourcePills}>
              <b>Purple paint</b>
              <b>Drop cloth</b>
              <b>Roller</b>
              <b>Brush</b>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.relationshipSection}>
        <div className={styles.sectionHeading}>
          <span>This one move also updates</span>
          <small>one task · no duplicates</small>
        </div>
        <RelationChips relations={[
          { kind: "Project", label: "Entry Refresh" },
          { kind: "Place", label: "Entry room" },
          { kind: "Place", label: "Library" },
        ]} />
      </section>

      <section className={styles.evidenceSection}>
        <div className={styles.sectionHeading}>
          <span>Evidence of arrival</span>
          <small>not percent complete</small>
        </div>
        <div className={styles.evidenceList}>
          <span>Entry door surface is purple</span>
          <span>Library door surface is purple</span>
          <span>Café lights + signage installed</span>
          <span>Final guest-ready check passes</span>
        </div>
      </section>
    </article>
  );
}

function LilacHavenMap() {
  return (
    <div className={styles.lilacMap} aria-label="Illustrative iris drift placement map">
      {Array.from({ length: 18 }, (_, index) => {
        const planted = [1, 2, 5, 6, 10, 11, 14, 15, 16].includes(index);
        return <span key={index} data-planted={planted ? "true" : "false"}>{planted ? "o" : "·"}</span>;
      })}
    </div>
  );
}

function LilacHavenSpecimen() {
  const steps: TrailStep[] = [
    { label: "Clear edge", detail: "ready", state: "done" },
    { label: "Divide + plant", detail: "3 iris clumps", state: "now" },
    { label: "Establish", detail: "check new drifts", state: "locked" },
    { label: "Edge + mulch", detail: "after establishment", state: "locked" },
    { label: "Final check", detail: "garden reads intentional", state: "locked" },
  ];

  return (
    <article className={styles.projectCard}>
      <header className={styles.projectHeader}>
        <div className={styles.kickerRow}>
          <span>Project</span>
          <small>shared-task specimen</small>
        </div>
        <h2>Finish Lilac Haven</h2>
        <div className={styles.destination}>
          <span>Destination</span>
          <strong>Lilac Haven reads as an intentional, established perennial garden</strong>
        </div>
      </header>

      <ProjectTrail label="Finish Lilac Haven project trail" steps={steps} />

      <section className={styles.activeMove}>
        <div className={styles.moveHeading}>
          <div>
            <span>Active move · Divide + plant</span>
            <h3>Lilac Haven</h3>
          </div>
          <b>3 clumps</b>
        </div>

        <div className={styles.transferGrid}>
          <div>
            <span>Take from</span>
            <strong>3 iris clumps</strong>
            <small>Lilac Haven fence line</small>
          </div>
          <div className={styles.transferArrow} aria-hidden="true">→</div>
          <div>
            <span>Plant into</span>
            <strong>New iris drifts</strong>
            <small>actual divisions logged at finish</small>
          </div>
        </div>

        <div className={styles.mapBlock}>
          <div className={styles.sectionHeading}>
            <span>Placement preview</span>
            <small>same place-first grammar</small>
          </div>
          <LilacHavenMap />
        </div>
      </section>

      <section className={styles.relationshipSection}>
        <div className={styles.sectionHeading}>
          <span>This one move also updates</span>
          <small>one physical act</small>
        </div>
        <RelationChips relations={[
          { kind: "Project", label: "Finish Lilac Haven" },
          { kind: "Lifecycle", label: "Iris" },
          { kind: "Place", label: "Lilac Haven" },
        ]} />
      </section>

      <section className={styles.evidenceSection}>
        <div className={styles.sectionHeading}>
          <span>Evidence of arrival</span>
          <small>project closes when reality does</small>
        </div>
        <div className={styles.evidenceList}>
          <span>New iris divisions occupy intended drifts</span>
          <span>Establishment check passes</span>
          <span>Edges + mulch are finished</span>
          <span>Final garden check reads intentional</span>
        </div>
      </section>
    </article>
  );
}

function GrammarStrip() {
  const grammar = [
    ["Destination", "What must become true"],
    ["Reality", "What is true now"],
    ["Moves", "State-changing tasks"],
    ["Gates", "What unlocks next"],
    ["Evidence", "Proof we arrived"],
  ];

  return (
    <section className={styles.grammar}>
      <div className={styles.sectionHeading}>
        <span>Project contract</span>
        <small>the trail owns continuity · card family owns execution</small>
      </div>
      <div className={styles.grammarGrid}>
        {grammar.map(([label, detail]) => (
          <div key={label}><strong>{label}</strong><span>{detail}</span></div>
        ))}
      </div>
    </section>
  );
}

export default function ProjectTrailLabPage() {
  return (
    <main className={styles.page}>
      <header className={styles.labHeader}>
        <span>Atlas · owner design lab</span>
        <h1>Project Trail Editor</h1>
        <p>Projects as destination-led Trails. Fixture-only design surface: no project, task, or Supabase writes.</p>
        <div className={styles.labLinks}>
          <Link href="/owner/task-card-lab">Task Card Editor</Link>
          <Link href="/projects">Current Projects</Link>
        </div>
      </header>

      <GrammarStrip />

      <nav className={styles.jumpNav} aria-label="Project Trail specimens">
        <a href="#entry-refresh">Entry Refresh</a>
        <a href="#lilac-haven">Lilac Haven</a>
      </nav>

      <div className={styles.gallery}>
        <div id="entry-refresh" className={styles.cardAnchor}><EntryRefreshSpecimen /></div>
        <div id="lilac-haven" className={styles.cardAnchor}><LilacHavenSpecimen /></div>
      </div>

      <aside className={styles.ownerNote}>
        <span>Editor rule</span>
        <p>A project never creates a second copy of a task. It references the same move used by its execution card, place history, and living-object lifecycle.</p>
      </aside>
    </main>
  );
}
