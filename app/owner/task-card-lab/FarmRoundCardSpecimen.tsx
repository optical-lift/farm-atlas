"use client";

import { useState } from "react";

import DominionCardFrame from "./DominionCardFrame";
import localStyles from "./venue-local-rail.module.css";
import venueStyles from "./venue-card-specimen.module.css";
import styles from "./farm-round-card-specimen.module.css";

type RoundItem = {
  id: string;
  label: string;
  detail?: string;
  issues?: string[];
};

type RoundStop = {
  place: string;
  items: RoundItem[];
};

const route: RoundStop[] = [
  {
    place: "House",
    items: [
      { id: "sweep-porches", label: "Sweep porches", detail: "Front + side" },
      { id: "trash-street", label: "Trash to street" },
    ],
  },
  {
    place: "Farmyard",
    items: [
      {
        id: "chickens",
        label: "Chicken chore",
        issues: ["Feed low", "Water problem", "Chicken concern", "Other"],
      },
    ],
  },
  {
    place: "Gardens + Grounds",
    items: [
      {
        id: "water-outdoor",
        label: "Water outdoor plants",
        issues: ["Hose problem", "Plant stress", "Water unavailable", "Other"],
      },
    ],
  },
];

const dueItems = route.flatMap((stop) => stop.items);

function IssueDrawer({ item }: { item: RoundItem }) {
  if (!item.issues?.length) return null;
  return (
    <details className={`${venueStyles.restockDrawer} ${styles.issueDrawer}`}>
      <summary aria-label={`Report an issue with ${item.label}`} title={`Report an issue with ${item.label}`}>
        <span aria-hidden="true">+</span>
      </summary>
      <div className={styles.issuePanel}>
        {item.issues.map((issue) => <button type="button" key={issue}>{issue}</button>)}
      </div>
    </details>
  );
}

function RoundRow({ item, checked, onToggle }: { item: RoundItem; checked: boolean; onToggle: () => void }) {
  const id = `farm-round-${item.id}`;
  return (
    <div className={`${venueStyles.reminderRow} ${localStyles.localReminderRow} ${styles.roundRow}`} data-done={checked ? "true" : "false"}>
      <input className={venueStyles.reminderToggle} id={id} type="checkbox" checked={checked} onChange={onToggle} />
      <label className={venueStyles.reminderCheck} htmlFor={id}>
        <span className={styles.itemCopy}>
          <strong>{item.label}</strong>
          {item.detail ? <small>{item.detail}</small> : null}
        </span>
      </label>
      <IssueDrawer item={item} />
    </div>
  );
}

export default function FarmRoundCardSpecimen() {
  const [done, setDone] = useState<string[]>([]);
  const complete = done.length === dueItems.length;

  function toggle(itemId: string) {
    setDone((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  return (
    <div className={styles.specimen}>
      <DominionCardFrame
        family="Stewardship"
        familyDetail="recurring round"
        title="Farm Round"
        subtitle="Elm Farm"
        timing={complete ? "Round complete" : `${dueItems.length - done.length} items due`}
        completion={false}
      >
        <div className={venueStyles.rowKey} aria-label="Farm Round controls">
          <span>tap to cross off</span>
          <span><b>+</b> report issue</span>
        </div>

        <div className={venueStyles.stations} aria-label="Farm Round walking route">
          {route.map((stop) => (
            <section className={`${venueStyles.station} ${localStyles.localStation}`} key={stop.place}>
              <header className={venueStyles.stationHeader}>
                <div><h3>{stop.place}</h3></div>
              </header>
              <div className={venueStyles.resourceList}>
                {stop.items.map((item) => (
                  <RoundRow
                    item={item}
                    checked={done.includes(item.id)}
                    onToggle={() => toggle(item.id)}
                    key={item.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </DominionCardFrame>

      <aside className={styles.dayPreviewTruth}>
        <span>Day overview contract · owner-only note</span>
        <p>The collapsed Day-feed Farm Round must expose the actual due stewardship rows in miniature, in the same physical route order, so the Worker can see Sweep porches, Trash to street, Chicken chore, Water outdoor plants, or whatever is due without opening the round. Do not collapse this to only a title or an item count.</p>
        <div className={styles.dayPreviewMock} aria-label="Future Day-feed Farm Round miniature preview">
          <header><strong>Farm Round</strong><small>4 due</small></header>
          <div>{dueItems.map((item) => <span key={item.id}>{item.label}</span>)}</div>
        </div>
      </aside>
    </div>
  );
}
