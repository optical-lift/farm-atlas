import styles from "./venue-card-specimen.module.css";

type VenueThing = {
  label: string;
  detail?: string;
  actions: string[];
};

type VenueStation = {
  id: string;
  title: string;
  location?: string;
  resources: VenueThing[];
};

const stations: VenueStation[] = [
  {
    id: "coffee-bar",
    title: "Coffee bar",
    location: "Dining room",
    resources: [
      {
        label: "Keurig",
        detail: "Equipment · Ready",
        actions: ["Problem", "Broken / cannot use", "Working again", "Request change"],
      },
      {
        label: "Coffee",
        detail: "Consumable · On hand",
        actions: ["Running low", "Out", "Estimate remaining", "Request change"],
      },
      {
        label: "Milk",
        detail: "Consumable · On hand",
        actions: ["Running low", "Out", "Estimate remaining", "Request change"],
      },
      {
        label: "Flavored syrup",
        detail: "Consumable · On hand",
        actions: ["Running low", "Out", "Estimate remaining", "Request change"],
      },
      {
        label: "Mug hutch",
        detail: "Mugs available",
        actions: ["Running low", "Empty", "Something changed", "Request change"],
      },
    ],
  },
  {
    id: "water",
    title: "Water",
    location: "Dining room",
    resources: [
      {
        label: "Water dispenser",
        detail: "Equipment · Full",
        actions: ["Needs refill", "Problem", "Working again", "Request change"],
      },
      {
        label: "Clear cups",
        detail: "On tray beside dispenser",
        actions: ["Running low", "Out", "Count remaining", "Request change"],
      },
    ],
  },
  {
    id: "blooms",
    title: "Blooms",
    location: "For sale at Community Thursday",
    resources: [
      {
        label: "12 posies",
        detail: "Presold · live from event orders",
        actions: ["Count changed", "Order changed", "Cannot fulfill", "Request change"],
      },
      {
        label: "6 bouquets",
        detail: "Presold · live from event orders",
        actions: ["Count changed", "Order changed", "Cannot fulfill", "Request change"],
      },
    ],
  },
];

function IssueDrawer({ thing }: { thing: VenueThing }) {
  return (
    <details className={styles.issueDrawer}>
      <summary aria-label={`Report a problem with ${thing.label}`} title={`Problem with ${thing.label}`}>
        <span aria-hidden="true">+</span>
        <small>issue</small>
      </summary>
      <div className={styles.resourceDrawer}>
        {thing.detail ? (
          <div className={styles.currentTruth}>
            <span>Current truth</span>
            <strong>{thing.detail}</strong>
          </div>
        ) : null}
        <p>What is wrong?</p>
        <div className={styles.resourceActions}>
          {thing.actions.map((action) => (
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

function CheckableThing({ thing, id }: { thing: VenueThing; id: string }) {
  return (
    <div className={styles.checkableThing}>
      <label className={styles.checkTarget} htmlFor={id}>
        <input id={id} type="checkbox" />
        <span className={styles.box} aria-hidden="true" />
        <strong>{thing.label}</strong>
      </label>
      <IssueDrawer thing={thing} />
    </div>
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

function RowKey() {
  return (
    <div className={styles.rowKey} aria-label="Venue row controls">
      <span><b>□</b> check when it is set</span>
      <span><b>+</b> issue only</span>
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
      <RowKey />

      <div className={styles.stations}>
        {stations.map((station) => (
          <section className={styles.station} key={station.title}>
            <header className={styles.stationHeader}>
              <div>
                <h3>{station.title}</h3>
                {station.location ? <span>{station.location}</span> : null}
              </div>
              <small>{station.resources.length} checks</small>
            </header>
            <div className={styles.resourceList}>
              {station.resources.map((resource, index) => (
                <CheckableThing
                  thing={resource}
                  id={`prep-${station.id}-${index}`}
                  key={resource.label}
                />
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
  const checklist: VenueThing[] = [
    {
      label: "Turn on the ice maker",
      detail: "Opening action",
      actions: ["Cannot turn on", "Equipment problem", "Already on", "Request change"],
    },
    {
      label: "Turn on the OPEN sign",
      detail: "Opening action",
      actions: ["Cannot turn on", "Sign problem", "Already on", "Request change"],
    },
    {
      label: "Open the yellow door",
      detail: "Opening action",
      actions: ["Cannot open", "Door problem", "Already open", "Request change"],
    },
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
      <RowKey />

      <section className={styles.hostChecklist}>
        <header>
          <span>Open the event</span>
          <small>3 checks</small>
        </header>
        <div className={styles.hostRows}>
          {checklist.map((item, index) => (
            <CheckableThing thing={item} id={`host-${index}`} key={item.label} />
          ))}
        </div>
      </section>

      <footer className={styles.finish}>
        <span>Finish Host</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Event open</button>
          <button type="button">Blocked</button>
        </div>
        <small>Check confirms the physical state changed. The + opens an issue drawer only when the action cannot be completed normally.</small>
      </footer>
    </article>
  );
}

function GuestRoomsCard() {
  const rooms: VenueThing[] = [
    {
      label: "Library · visibly guest-ready",
      detail: "Room reset standard",
      actions: ["Still needs work", "Something is missing", "Damage / problem", "Request change"],
    },
    {
      label: "Meeting room · visibly guest-ready",
      detail: "Room reset standard",
      actions: ["Still needs work", "Something is missing", "Damage / problem", "Request change"],
    },
    {
      label: "Kitchen · trash cleared",
      detail: "Room reset standard",
      actions: ["Still needs work", "Something is missing", "Damage / problem", "Request change"],
    },
  ];

  return (
    <article className={`${styles.card} ${styles.roomCard}`}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Venue</span>
          <small>room reset</small>
        </div>
        <h2>Guest rooms</h2>
        <p>Library · Meeting room · Kitchen</p>
        <div className={styles.timing}>Before guests arrive</div>
      </header>

      <RowKey />

      <div className={styles.roomRows}>
        {rooms.map((room, index) => (
          <CheckableThing thing={room} id={`guest-room-${index}`} key={room.label} />
        ))}
      </div>

      <footer className={styles.finish}>
        <span>Finish Guest rooms</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Rooms ready</button>
          <button type="button">Something remains</button>
        </div>
        <small>The same Venue interaction grammar now carries across station prep, event opening, and room reset.</small>
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
          Venue rows now have two completely separate meanings: the square is the ordinary successful check, while + means there is a problem and is the only control that opens the object drawer. The same interaction premise applies to station resources, Host opening actions, and room-reset checks.
        </p>
        <p>
          Event quantities remain live while future tasks sit in the queue. Presold posies and bouquets come from event demand; harvest results can later update fulfillment truth or create a Bell decision without silently lowering the sold quantity.
        </p>
      </aside>

      <div className={styles.nextVariantLabel}>
        <span>Same Venue family · next unlocked task</span>
      </div>

      <HostCard />

      <div className={styles.nextVariantLabel}>
        <span>Same Venue family · room reset variant</span>
      </div>

      <GuestRoomsCard />
    </div>
  );
}
