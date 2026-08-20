import styles from "./venue-card-specimen.module.css";

type VenueResource = {
  label: string;
  kind: string;
  state: string;
  source?: string;
  actions: string[];
};

type VenueStation = {
  title: string;
  location?: string;
  resources: VenueResource[];
};

const stations: VenueStation[] = [
  {
    title: "Coffee bar",
    location: "Dining room",
    resources: [
      {
        label: "Keurig",
        kind: "Equipment",
        state: "Ready",
        actions: ["Problem", "Broken / cannot use", "Working again", "Request change"],
      },
      {
        label: "Coffee",
        kind: "Consumable",
        state: "On hand",
        actions: ["Running low", "Out", "Estimate remaining", "Request change"],
      },
      {
        label: "Mug hutch",
        kind: "Station resource",
        state: "Mugs available",
        actions: ["Running low", "Empty", "Something changed", "Request change"],
      },
    ],
  },
  {
    title: "Water",
    location: "Dining room",
    resources: [
      {
        label: "Water dispenser",
        kind: "Equipment",
        state: "Full",
        actions: ["Needs refill", "Problem", "Working again", "Request change"],
      },
      {
        label: "Clear cups",
        kind: "Consumable",
        state: "On tray beside dispenser",
        actions: ["Running low", "Out", "Count remaining", "Request change"],
      },
      {
        label: "Cup tray",
        kind: "Station object",
        state: "In place",
        actions: ["Missing", "Moved", "Something changed", "Request change"],
      },
    ],
  },
  {
    title: "Blooms",
    location: "For sale at Community Thursday",
    resources: [
      {
        label: "12 posies",
        kind: "Event demand",
        state: "Presold",
        source: "Live from event orders",
        actions: ["Count changed", "Order changed", "Cannot fulfill", "Request change"],
      },
      {
        label: "6 bouquets",
        kind: "Event demand",
        state: "Presold",
        source: "Live from event orders",
        actions: ["Count changed", "Order changed", "Cannot fulfill", "Request change"],
      },
    ],
  },
];

function ResourceRow({ resource }: { resource: VenueResource }) {
  return (
    <details className={styles.resource}>
      <summary>
        <span>
          <strong>{resource.label}</strong>
          <small>{resource.kind} · {resource.state}</small>
          {resource.source ? <em>{resource.source}</em> : null}
        </span>
        <span className={styles.resourceChevron}>+</span>
      </summary>
      <div className={styles.resourceDrawer}>
        <p>What changed?</p>
        <div className={styles.resourceActions}>
          {resource.actions.map((action) => (
            <button type="button" key={action}>{action}</button>
          ))}
        </div>
        <label>
          Tell Lex something else
          <textarea rows={2} placeholder="Only what changed or what she needs to know…" />
        </label>
        <button type="button" className={styles.noteButton}>Send note</button>
        <small>Mock only · this does not write to Atlas yet.</small>
      </div>
    </details>
  );
}

function EventTrail({ current }: { current: "prep" | "host" }) {
  return (
    <div className={styles.trail} aria-label="Community Thursday task dependency trail">
      <span className={current === "host" ? styles.trailDone : styles.trailNow}>
        <b>Prep</b>
        <small>Community Thursday</small>
      </span>
      <span className={current === "host" ? styles.trailNow : styles.trailLocked}>
        <b>Host</b>
        <small>Community Thursday</small>
      </span>
      <span className={styles.trailLocked}>
        <b>Reset</b>
        <small>Community Thursday</small>
      </span>
    </div>
  );
}

function PrepCard() {
  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Venue</span>
          <small>weekly event template</small>
        </div>
        <h2>Prep Community Thursday</h2>
        <p>Community Thursday · Elm Farm</p>
        <div className={styles.timing}>Wednesday · night-before prep</div>
      </header>

      <EventTrail current="prep" />

      <div className={styles.stations}>
        {stations.map((station) => (
          <section className={styles.station} key={station.title}>
            <header className={styles.stationHeader}>
              <h3>{station.title}</h3>
              {station.location ? <span>{station.location}</span> : null}
            </header>
            <div className={styles.resourceList}>
              {station.resources.map((resource) => (
                <ResourceRow resource={resource} key={resource.label} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className={styles.finish}>
        <span>Finish Prep</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Prep complete</button>
          <button type="button">Something is not ready</button>
        </div>
        <small>Completing Prep unlocks Host Community Thursday.</small>
      </footer>
    </article>
  );
}

function HostCard() {
  const checklist = [
    "Turn on the ice maker",
    "Turn on the OPEN sign",
    "Open the yellow door",
  ];

  return (
    <article className={`${styles.card} ${styles.hostCard}`}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Venue</span>
          <small>event opening</small>
        </div>
        <h2>Host Community Thursday</h2>
        <p>Community Thursday · Elm Farm</p>
        <div className={styles.timing}>Thursday morning · Prep complete</div>
      </header>

      <EventTrail current="host" />

      <section className={styles.hostChecklist}>
        <header>
          <span>Open the event</span>
          <small>0 / 3</small>
        </header>
        <div>
          {checklist.map((item) => (
            <label key={item}>
              <input type="checkbox" />
              <span>{item}</span>
            </label>
          ))}
        </div>
      </section>

      <footer className={styles.finish}>
        <span>Finish Host</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Event open</button>
          <button type="button">Blocked</button>
        </div>
        <small>Checklist actions are real state changes, so they stay checkable.</small>
      </footer>
    </article>
  );
}

export default function VenueCardSpecimen() {
  return (
    <div className={styles.venueSpecimen}>
      <PrepCard />

      <aside className={styles.templateTruth}>
        <span>Template truth · owner-only note</span>
        <p>
          Community Thursday repeats as one governed event cycle. Prep unlocks Host; Host can unlock Reset. Readiness requirements such as mowing being current by the day before the event belong to the event template but do not appear as Worker Trail nodes.
        </p>
        <p>
          Event quantities remain live while future tasks sit in the queue. Presold posies and bouquets come from event demand; harvest results can later update fulfillment truth or create a Bell decision without silently lowering the sold quantity.
        </p>
      </aside>

      <div className={styles.nextVariantLabel}>
        <span>Same Venue family · next unlocked task</span>
      </div>

      <HostCard />
    </div>
  );
}
