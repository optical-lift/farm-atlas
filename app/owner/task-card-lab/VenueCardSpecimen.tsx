import styles from "./venue-card-specimen.module.css";

type VenueResource = {
  label: string;
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
      { label: "Keurig" },
      { label: "Coffee grounds" },
      { label: "Milk" },
      { label: "Flavored syrup" },
      { label: "Mug hutch" },
    ],
  },
  {
    id: "water",
    title: "Water",
    location: "Dining room",
    resources: [
      { label: "Water dispenser" },
      { label: "Clear cups" },
    ],
  },
  {
    id: "blooms",
    title: "Blooms",
    location: "For sale at Community Thursday",
    resources: [
      { label: "12 posies" },
      { label: "6 bouquets" },
    ],
  },
];

function RestockDrawer({ label }: { label: string }) {
  return (
    <details className={styles.restockDrawer}>
      <summary aria-label={`Request restock for ${label}`} title={`Request restock for ${label}`}>
        <span aria-hidden="true">+</span>
      </summary>
      <div className={styles.restockPanel}>
        <button type="button">Restock</button>
        <label>
          <span>Note</span>
          <input type="text" placeholder="Add note…" />
        </label>
      </div>
    </details>
  );
}

function ReminderRow({ resource, id }: { resource: VenueResource; id: string }) {
  return (
    <div className={styles.reminderRow}>
      <input className={styles.reminderToggle} id={id} type="checkbox" />
      <label className={styles.reminderCheck} htmlFor={id}>
        <strong>{resource.label}</strong>
      </label>
      <RestockDrawer label={resource.label} />
    </div>
  );
}

function RoomReminderRow({ label, id }: { label: string; id: string }) {
  return (
    <div className={styles.reminderRow}>
      <input className={styles.reminderToggle} id={id} type="checkbox" />
      <label className={styles.reminderCheck} htmlFor={id}>
        <strong>{label}</strong>
      </label>
      <details className={styles.restockDrawer}>
        <summary aria-label={`Add a note about ${label}`} title={`Add a note about ${label}`}>
          <span aria-hidden="true">+</span>
        </summary>
        <div className={styles.restockPanel}>
          <label>
            <span>Note</span>
            <input type="text" placeholder="Add note…" />
          </label>
        </div>
      </details>
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

function PrepKey() {
  return (
    <div className={styles.rowKey} aria-label="Venue prep reminder controls">
      <span>tap to cross off</span>
      <span><b>+</b> request restock</span>
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
      <PrepKey />

      <div className={styles.stations}>
        {stations.map((station) => (
          <section className={styles.station} key={station.title}>
            <header className={styles.stationHeader}>
              <div>
                <h3>{station.title}</h3>
                {station.location ? <span>{station.location}</span> : null}
              </div>
            </header>
            <div className={styles.resourceList}>
              {station.resources.map((resource, index) => (
                <ReminderRow
                  resource={resource}
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
        <small>The reminder marks above are optional memory aids. They do not gate Prep completion.</small>
      </footer>
    </article>
  );
}

function ClassicChecklistRow({ label, id }: { label: string; id: string }) {
  return (
    <label className={styles.classicCheckItem} htmlFor={id}>
      <input id={id} type="checkbox" />
      <span className={styles.classicCircle} aria-hidden="true" />
      <strong>{label}</strong>
    </label>
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
          <small>3 steps</small>
        </header>
        <div className={styles.classicChecklist}>
          {checklist.map((item, index) => (
            <ClassicChecklistRow label={item} id={`host-${index}`} key={item} />
          ))}
        </div>
      </section>

      <footer className={styles.finish}>
        <span>Finish Host</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Event open</button>
          <button type="button">Blocked</button>
        </div>
        <small>Host is a true execution checklist, so it uses the original Atlas checklist grammar.</small>
      </footer>
    </article>
  );
}

function GuestRoomsCard() {
  const rooms = [
    "Library · visibly guest-ready",
    "Meeting room · visibly guest-ready",
    "Kitchen · trash cleared",
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

      <div className={styles.roomRows}>
        {rooms.map((room, index) => (
          <RoomReminderRow label={room} id={`guest-room-${index}`} key={room} />
        ))}
      </div>

      <footer className={styles.finish}>
        <span>Finish Guest rooms</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Rooms ready</button>
          <button type="button">Something remains</button>
        </div>
        <small>Room checks are reminders, not completion gates, unless a future Venue variant explicitly defines them as execution steps.</small>
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
          Prep and room-reset rows are reminders: tapping the resource itself simply crosses out what Anna has looked at, and none of those marks are required to complete the task. The + affordance is reserved for the tiny Restock / Note request drawer.
        </p>
        <p>
          Host is different because its rows are genuine state-changing actions. It therefore uses the first Atlas checklist visual grammar recovered from July 6: a rounded task row with a round completion control.
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
