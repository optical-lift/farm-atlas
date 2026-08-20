"use client";

import { useMemo, useState } from "react";

import DominionCardFrame from "./DominionCardFrame";
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

function IssueDrawer({ item }: { item: RoundItem }) {
  if (!item.issues?.length) return null;
  return (
    <details className={styles.issueDrawer}>
      <summary aria-label={`Log an issue with ${item.label}`} title={`Log an issue with ${item.label}`}>
        <span aria-hidden="true">+</span>
      </summary>
      <div className={styles.issuePanel}>
        {item.issues.map((issue) => <button type="button" key={issue}>{issue}</button>)}
      </div>
    </details>
  );
}

export default function FarmRoundCardSpecimen() {
  const [done, setDone] = useState<string[]>([]);
  const dueItems = useMemo(() => route.flatMap((stop) => stop.items), []);
  const complete = done.length === dueItems.length;

  function toggle(itemId: string) {
    setDone((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  return (
    <DominionCardFrame
      family="Stewardship"
      familyDetail="recurring round"
      title="Farm Round"
      subtitle="Elm Farm"
      timing={complete ? "Round complete" : `${dueItems.length - done.length} items due`}
      completion={false}
    >
      <div className={styles.route} aria-label="Farm Round walking route">
        {route.map((stop, stopIndex) => (
          <section className={styles.stop} key={stop.place}>
            <header>
              <span>{stopIndex + 1}</span>
              <h3>{stop.place}</h3>
            </header>
            <div className={styles.items}>
              {stop.items.map((item) => {
                const checked = done.includes(item.id);
                return (
                  <div className={styles.item} data-done={checked ? "true" : "false"} key={item.id}>
                    <button type="button" className={styles.completeButton} aria-pressed={checked} onClick={() => toggle(item.id)}>
                      <span className={styles.circle} aria-hidden="true" />
                      <span className={styles.itemText}>
                        <strong>{item.label}</strong>
                        {item.detail ? <small>{item.detail}</small> : null}
                      </span>
                    </button>
                    <IssueDrawer item={item} />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </DominionCardFrame>
  );
}
