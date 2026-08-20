import styles from "./venue-card-specimen.module.css";

type VenueResource = {
  label: string;
  detail?: string;
  actions: string[];
};

type VenueStation = {
  id: string;
  title: string;
  location?: string;
  resources: VenueResource[];
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

function QuickCheck({ id }: { id: string }) {
  return (
    <span className={styles.quickCheck}>
      <input id={id} type="checkbox" />
      <label htmlFor={id}>Check</label>
    </span>
  );
}

function ResourceRow({ resource }: { resource: VenueResource }) {
  return (
    <details className={styles.resource}>
      <summary>
        <strong>{resource.label}</strong>
        <span className={styles.resourceChevron}>+</span>
      </summary>
      <div className={styles.resourceDrawer}>
        {resource.detail ? (
          <div className={styles.currentTruth}>
            <span>Current truth</span>
            <strong>{resource.detail}</strong>
          </div>
        ) : null}
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
              <div>
                <h3>{station.title}</h3>
                {station.location ? <span>{station.location}</span> : null}
              </div>
              <QuickCheck id={`prep-${station.id}-check`} />
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

function GuestRoomsCard() {
  const rooms = [
    { id: "library", title: "Library", state: "Visibly guest-ready" },
    { id: "meeting-room", title: "Meeting room", state: "Visibly guest-ready" },
    { id: "kitchen", title: "Kitchen", state: "Trash cleared" },
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

      <div className={styles.rooms}>
        {rooms.map((room) => (
          <section className={styles.room} key={room.id}>
            <header>
              <div>
                <h3>{room.title}</h3>
                <p>{room.state}</p>
              </div>
              <QuickCheck id={`guest-room-${room.id}-check`} />
            </header>
          </section>
        ))}
      </div>

      <footer className={styles.finish}>
        <span>Finish Guest rooms</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Rooms ready</button>
          <button type="button">Something remains</button>
        </div>
        <small>The same Venue shell can present rooms instead of stations. Real objects become tappable resources only when the room actually needs them.</small>
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
          Venue resources stay visually compact: the card names the thing once, while current state and update choices live inside its tap drawer. Each station or room gets a small Check control for a human return-pass without turning every resource into a checklist item.
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
