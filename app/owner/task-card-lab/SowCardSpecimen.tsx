import styles from "./sow-card-specimen.module.css";

const bedTrail = [
  { label: "Prepared", detail: "bed ready", state: "done" },
  { label: "Sow", detail: "White Lite", state: "now" },
  { label: "Germination", detail: "4–10 days", state: "later" },
  { label: "Harvest", detail: "50–60 days", state: "later" },
  { label: "Clear", detail: "75 days", state: "later" },
] as const;

const roster = [
  { label: "Spacing", value: "4 in" },
  { label: "Germination", value: "4–10 days" },
  { label: "Harvest watch", value: "50–60 days" },
  { label: "Clear bed", value: "75 days" },
] as const;

function SeedIssueDrawer() {
  return (
    <details className={styles.seedDrawer}>
      <summary aria-label="Report a seed issue" title="Report a seed issue">
        <span aria-hidden="true">+</span>
      </summary>
      <div className={styles.seedPanel}>
        <button type="button">Packet empty</button>
        <label>
          <span>Note</span>
          <input type="text" placeholder="Add note…" />
        </label>
      </div>
    </details>
  );
}

export default function SowCardSpecimen() {
  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Sow</span>
          <small>direct sow bed</small>
        </div>
        <h2>Field Row 6</h2>
        <p>ProCut White Lite · sunflower</p>
        <div className={styles.timing}>Tonight · sowing window open</div>
      </header>

      <div className={styles.trail} aria-label="Field Row 6 crop-cycle trail">
        {bedTrail.map((step) => (
          <span
            className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater}
            key={step.label}
          >
            <b>{step.label}</b>
            <small>{step.detail}</small>
          </span>
        ))}
      </div>

      <section className={styles.bedSection}>
        <header className={styles.bedHeader}>
          <div>
            <h3>Field Row 6</h3>
            <span>Field Rows</span>
          </div>
        </header>

        <div className={styles.seedRow}>
          <div>
            <small>Seed</small>
            <strong>ProCut White Lite</strong>
          </div>
          <SeedIssueDrawer />
        </div>

        <div className={styles.pattern}>
          <small>Sow pattern</small>
          <strong>3 lengthwise rows · 1/2 in deep</strong>
        </div>

        <div className={styles.roster} aria-label="ProCut White Lite crop profile projections">
          {roster.map((item) => (
            <div key={item.label}>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <footer className={styles.finish}>
        <span>Finish Sow</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Sowing complete</button>
          <button type="button">Partly sown</button>
        </div>
        <small>
          The bed is the enduring object. Completing Sow advances Field Row 6 into the crop cycle and dates its next projected states.
        </small>
      </footer>
    </article>
  );
}
