"use client";

import { useState } from "react";

import styles from "./grow-room-board-specimen.module.css";

type RackSpec = {
  key: string;
  title: string;
  subtitle: string;
  shelves: number;
  litShelves: number;
  environment: string;
  proposedLabel: string;
  slotsKnown: boolean;
};

type RoundItem = {
  id: string;
  crop: string;
  location: string;
  carrier: string;
};

const racks: RackSpec[] = [
  {
    key: "tall-1",
    title: "Tall Rack 1",
    subtitle: "5 shelf levels · no grow lights installed",
    shelves: 5,
    litShelves: 0,
    environment: "Grow Room",
    proposedLabel: "GR1",
    slotsKnown: false,
  },
  {
    key: "tall-2",
    title: "Tall Rack 2",
    subtitle: "5 shelf levels · no grow lights installed",
    shelves: 5,
    litShelves: 0,
    environment: "Grow Room",
    proposedLabel: "GR2",
    slotsKnown: false,
  },
  {
    key: "short",
    title: "Short Rack",
    subtitle: "4 shelf levels · all 4 currently lit",
    shelves: 4,
    litShelves: 4,
    environment: "Grow Room",
    proposedLabel: "GR3",
    slotsKnown: false,
  },
  {
    key: "hardening",
    title: "Hardening Rack",
    subtitle: "2 shelf levels · outside garage",
    shelves: 2,
    litShelves: 0,
    environment: "Outdoor hardening",
    proposedLabel: "HR1",
    slotsKnown: false,
  },
];

const roundItems: RoundItem[] = [
  {
    id: "snapdragon",
    crop: "Snapdragons",
    location: "Slot not logged yet",
    carrier: "¾ in soil blocks",
  },
  {
    id: "snow-in-summer",
    crop: "Snow in Summer",
    location: "Living room table",
    carrier: "Dense sow · 5×5 boxes",
  },
  {
    id: "strawflower",
    crop: "Strawflower",
    location: "Slot not logged yet",
    carrier: "Carrier not logged yet",
  },
];

const exceptionOptions = ["Dry", "Leggy", "Crowded / rootbound", "Needs pot-up", "Ready to harden", "Ready to plant", "Damage / loss", "Partial death", "Dead", "Other"];

function CapacityCard({ value, label, detail }: { value: string; label: string; detail: string }) {
  return (
    <article className={styles.capacityCard}>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </article>
  );
}

function Rack({ rack }: { rack: RackSpec }) {
  return (
    <article className={styles.rackCard}>
      <header>
        <div>
          <span>{rack.proposedLabel}</span>
          <h3>{rack.title}</h3>
          <p>{rack.subtitle}</p>
        </div>
        <small>{rack.environment}</small>
      </header>

      <div className={styles.rackFrame}>
        {Array.from({ length: rack.shelves }, (_, shelfIndex) => {
          const lit = rack.key === "short" && shelfIndex < rack.litShelves;
          return (
            <div className={styles.shelf} key={`${rack.key}-${shelfIndex + 1}`}>
              <div className={`${styles.lightBar} ${lit ? styles.lightOn : styles.lightOff}`}>
                <span>{lit ? "grow light" : rack.key === "hardening" ? "open air" : "no light"}</span>
              </div>
              <div className={styles.shelfLabel}>S{shelfIndex + 1}</div>
              <div className={styles.slotRow}>
                {["A", "B", "C", "D"].map((slot) => (
                  <button type="button" className={styles.slotUnknown} key={slot}>
                    <b>{slot}</b>
                    <span>?</span>
                    <small>not audited</small>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <footer>
        <span>{rack.shelves * 4} physical slots</span>
        <strong>{rack.key === "short" ? `${rack.litShelves * 4} lit now` : rack.key === "hardening" ? "8 hardening slots" : "0 lit now"}</strong>
      </footer>
    </article>
  );
}

function RoundRow({ item }: { item: RoundItem }) {
  const [status, setStatus] = useState<"good" | "exception" | null>(null);
  const [exception, setException] = useState<string | null>(null);

  return (
    <article className={`${styles.roundRow} ${status === "good" ? styles.goodRow : status === "exception" ? styles.exceptionRow : ""}`}>
      <div className={styles.roundIdentity}>
        <span>{item.location}</span>
        <strong>{item.crop}</strong>
        <small>{item.carrier}</small>
      </div>
      <div className={styles.roundActions}>
        <button type="button" className={status === "good" ? styles.goodButtonSelected : undefined} onClick={() => { setStatus("good"); setException(null); }}>Good</button>
        <details onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) setStatus("exception"); }}>
          <summary>+</summary>
          <div className={styles.exceptionPanel}>
            {exceptionOptions.map((option) => (
              <button type="button" className={exception === option ? styles.exceptionSelected : undefined} onClick={() => { setStatus("exception"); setException(option); }} key={option}>{option}</button>
            ))}
            <input type="text" placeholder="Optional note…" aria-label={`Note about ${item.crop}`} />
          </div>
        </details>
      </div>
      {exception ? <div className={styles.observation}><span>Observed</span><strong>{exception}</strong></div> : null}
    </article>
  );
}

export default function GrowRoomBoardSpecimen() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <span>ATLAS · OWNER DESIGN LAB</span>
        <h1>Grow Room</h1>
        <p>Living production board · fixture only · no Grow Room truth has been written back to Atlas yet.</p>
        <div className={styles.heroLinks}><a href="/owner/task-card-lab">← Task Card Gallery</a></div>
      </header>

      <section className={styles.capacitySection}>
        <header>
          <div><span>Capacity</span><h2>What the room can actually hold</h2></div>
          <small>physical ≠ lit ≠ hardening</small>
        </header>
        <div className={styles.capacityGrid}>
          <CapacityCard value="56" label="normal physical slots" detail="14 rack shelves × 4 tray footprints" />
          <CapacityCard value="16" label="lit slots now" detail="short rack · 4 lit shelves" />
          <CapacityCard value="+8" label="lit slots already owned" detail="lights in a box for 2 more shelves" />
          <CapacityCard value="8" label="hardening slots" detail="rolling rack outside garage" />
          <CapacityCard value="12" label="reserve floor slots" detail="possible, but not normal production capacity" />
        </div>
      </section>

      <section className={styles.attentionSection}>
        <header><span>Needs action</span><h2>Things already telling us the system is blind</h2></header>
        <div className={styles.attentionList}>
          <article>
            <div><span>Snow in Summer</span><strong>Pot up + get under lights</strong></div>
            <p>Dense-sown 5×5 boxes are on the living room table and getting leggier while the next stage waits.</p>
          </article>
          <article>
            <div><span>Strawflower</span><strong>Capture current state + plant-out move</strong></div>
            <p>Anna reported that it badly needs planted out, but Atlas does not yet carry its propagation Trail strongly enough.</p>
          </article>
          <article>
            <div><span>Room audit</span><strong>Label racks, shelves, and A/B/C/D slots</strong></div>
            <p>The short lit rack has plants on it, but Atlas does not know which living batch occupies which physical slot.</p>
          </article>
          <article>
            <div><span>Capacity</span><strong>Two more shelf lights already exist</strong></div>
            <p>Installing the stored lights raises normal lit capacity from 16 to 24 tray slots before any new purchase.</p>
          </article>
        </div>
      </section>

      <section className={styles.racksSection}>
        <header>
          <div><span>All racks</span><h2>Physical room ↔ Atlas room</h2></div>
          <small>Proposed GR1 / GR2 / GR3 / HR1 labels until tape labels are applied.</small>
        </header>
        <div className={styles.racksGrid}>{racks.map((rack) => <Rack rack={rack} key={rack.key} />)}</div>
      </section>

      <section className={styles.roundSection}>
        <header>
          <div><span>Twice-weekly round</span><h2>Good, good, good, oops.</h2></div>
          <small>Every living batch receives human eyes; normal batches take one tap.</small>
        </header>
        <div className={styles.roundList}>{roundItems.map((item) => <RoundRow item={item} key={item.id} />)}</div>
        <footer>
          <button type="button">Grow Room round checked</button>
          <small>Final implementation should generate this list from every living propagation batch, in physical route order.</small>
        </footer>
      </section>

      <section className={styles.ruleSection}>
        <span>Governing model</span>
        <p><strong>Batch</strong> owns the life plan. <strong>Carrier</strong> determines biological capacity. <strong>Slot</strong> determines physical capacity. <strong>Location</strong> determines environmental capacity.</p>
        <p>A batch remains on the board until it is transplanted, transferred away, discarded, or explicitly logged dead.</p>
      </section>
    </main>
  );
}
