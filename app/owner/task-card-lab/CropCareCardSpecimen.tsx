import bedStyles from "./weed-card-specimen.module.css";
import weedExtras from "./weed-turnover-additions.module.css";
import styles from "./crop-care-card-specimen.module.css";

type TrailStep = {
  label: string;
  detail: string;
  state: "done" | "now" | "later";
};

type ResourceCategory = {
  title: string;
  items: string[];
  note?: string;
  issueLabel?: string;
};

const BED_WIDTH_FT = 3;
const BED_LENGTH_FT = 30;
const MAP_BLOCK_FT = 3;

const mapBlocks = Array.from({ length: BED_LENGTH_FT / MAP_BLOCK_FT }, (_, index) => ({
  start: index * MAP_BLOCK_FT,
  end: (index + 1) * MAP_BLOCK_FT,
}));

const waterTrail: TrailStep[] = [
  { label: "Transplanted", detail: "Aug 17", state: "done" },
  { label: "Water", detail: "today", state: "now" },
  { label: "Check", detail: "Aug 22", state: "later" },
  { label: "Pinch", detail: "when ready", state: "later" },
  { label: "Harvest", detail: "later", state: "later" },
];

const checkTrail: TrailStep[] = [
  { label: "Sown", detail: "Aug 16", state: "done" },
  { label: "Germination", detail: "Aug 20–26", state: "done" },
  { label: "Check", detail: "today", state: "now" },
  { label: "Weed", detail: "next", state: "later" },
  { label: "Harvest", detail: "later", state: "later" },
];

const sprayTrail: TrailStep[] = [
  { label: "Transplanted", detail: "Jul 30", state: "done" },
  { label: "Checked", detail: "Aug 17", state: "done" },
  { label: "Spray BT", detail: "today", state: "now" },
  { label: "Check", detail: "Aug 23", state: "later" },
  { label: "Harvest", detail: "later", state: "later" },
];

function Trail({ steps, label }: { steps: TrailStep[]; label: string }) {
  return (
    <div className={bedStyles.trail} aria-label={label}>
      {steps.map((step) => (
        <span
          className={step.state === "done" ? bedStyles.trailDone : step.state === "now" ? bedStyles.trailNow : bedStyles.trailLater}
          key={`${step.label}-${step.detail}`}
        >
          <b>{step.label}</b>
          <small>{step.detail}</small>
        </span>
      ))}
    </div>
  );
}

function BedMap({ cropLabel, glyph = "o" }: { cropLabel: string; glyph?: string }) {
  return (
    <section className={bedStyles.bedMap}>
      <header>
        <span>Bed map</span>
        <small>{BED_WIDTH_FT} ft × {BED_LENGTH_FT} ft</small>
      </header>

      <div className={weedExtras.mapOrientation}>↑ back fence this side</div>

      <div className={bedStyles.bedRectangle} aria-label={`Crop occupancy map for ${cropLabel}`}>
        {mapBlocks.map((block, blockIndex) => (
          <button
            type="button"
            className={blockIndex === 0 ? bedStyles.mapBlockActive : bedStyles.mapBlock}
            key={block.start}
            aria-label={`Feet ${block.start} to ${block.end}, ${cropLabel}`}
          >
            {Array.from({ length: BED_WIDTH_FT * MAP_BLOCK_FT }, (_, squareIndex) => (
              <span key={squareIndex}>{glyph}</span>
            ))}
          </button>
        ))}
      </div>

      <div className={bedStyles.mapScale} aria-hidden="true">
        <span>0 ft</span>
        <span>15 ft</span>
        <span>30 ft</span>
      </div>

      <div className={bedStyles.mapDetail}>
        <span>0–3 ft</span>
        <strong>{cropLabel}</strong>
        <small>Same persistent crop/place map used by Weed, Check, Water, Spray, Pinch, and other crop operations.</small>
      </div>
    </section>
  );
}

function ResultChoice({ name, label }: { name: string; label: string }) {
  const id = `${name}-${label.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-")}`;
  return (
    <label className={bedStyles.resultPill} htmlFor={id}>
      <input id={id} type="radio" name={name} />
      <span>{label}</span>
    </label>
  );
}

function NoteDrawer({ label, ariaLabel }: { label: string; ariaLabel: string }) {
  return (
    <details className={bedStyles.logDrawer}>
      <summary>{label}</summary>
      <div className={bedStyles.logPanel}>
        <input type="text" placeholder="Add note…" aria-label={ariaLabel} />
        <button type="button">Save note</button>
      </div>
    </details>
  );
}

function IssueDrawer({ label }: { label: string }) {
  return (
    <details className={styles.resourceIssue}>
      <summary aria-label={label} title={label}>+</summary>
      <div>
        <button type="button">Missing</button>
        <button type="button">Problem</button>
        <input type="text" placeholder="What changed?" aria-label={`${label} note`} />
      </div>
    </details>
  );
}

function ResourceMethod({ categories }: { categories: ResourceCategory[] }) {
  return (
    <section className={styles.resourceMethod}>
      {categories.map((category) => (
        <section className={styles.resourceCategory} key={category.title}>
          <header>
            <h3>{category.title}</h3>
            {category.issueLabel ? <IssueDrawer label={category.issueLabel} /> : null}
          </header>
          <div className={styles.resourceRail}>
            {category.items.map((item) => <strong key={item}>{item}</strong>)}
          </div>
          {category.note ? <small>{category.note}</small> : null}
        </section>
      ))}
    </section>
  );
}

function WaterCard() {
  return (
    <article className={bedStyles.card}>
      <header className={bedStyles.header}>
        <div className={bedStyles.familyRow}>
          <span>Water</span>
          <small>crop operation</small>
        </div>
        <h2>Curve Garden Bed 2</h2>
        <p>Curve Garden</p>
      </header>

      <Trail steps={waterTrail} label="Curve Garden Bed 2 zinnia crop Trail" />

      <section className={bedStyles.cropState}>
        <span>Bed now</span>
        <strong>Benary’s Giant White zinnia</strong>
        <div>
          <b>Establishing after transplant</b>
          <b>Water is today’s move</b>
        </div>
      </section>

      <BedMap cropLabel="Benary’s Giant White zinnia" />

      <ResourceMethod
        categories={[
          {
            title: "Water",
            items: ["Deep water root zone"],
            note: "The operation lives on this crop/bed Trail; it is not a generic recurring irrigation chore.",
          },
          {
            title: "Water source",
            items: ["Hose / watering setup"],
            issueLabel: "Log a water-source issue",
          },
        ]}
      />

      <section className={bedStyles.results}>
        <header><span>What happened?</span></header>
        <div className={bedStyles.resultPills}>
          <ResultChoice name="water-result" label="Watered" />
          <ResultChoice name="water-result" label="Moisture already good" />
          <ResultChoice name="water-result" label="Still wilting" />
          <NoteDrawer label="Log it" ariaLabel="Add a water note" />
        </div>
      </section>

      <footer className={bedStyles.finish}>
        <span>Finish Water</span>
        <div>
          <button type="button" className={bedStyles.primaryFinish}>Water move recorded</button>
          <button type="button">Blocked</button>
        </div>
      </footer>
    </article>
  );
}

function CheckCard() {
  return (
    <article className={bedStyles.card}>
      <header className={bedStyles.header}>
        <div className={bedStyles.familyRow}>
          <span>Check germination</span>
          <small>crop observation</small>
        </div>
        <h2>Barn Bed 4</h2>
        <p>Barn Beds</p>
      </header>

      <Trail steps={checkTrail} label="Barn Bed 4 sunflower crop Trail" />

      <section className={bedStyles.cropState}>
        <span>Bed now</span>
        <strong>White sunflower</strong>
        <div>
          <b>Inside germination window</b>
          <b>Check decides what happens next</b>
        </div>
      </section>

      <BedMap cropLabel="White sunflower" glyph="·" />

      <section className={bedStyles.results}>
        <header><span>How’d we do?</span></header>
        <div className={bedStyles.resultPills}>
          <ResultChoice name="check-result" label="Strong" />
          <ResultChoice name="check-result" label="Patchy" />
          <ResultChoice name="check-result" label="Failed" />
          <ResultChoice name="check-result" label="Too early to tell" />
          <NoteDrawer label="Log it" ariaLabel="Add a germination observation" />
        </div>
      </section>

      <footer className={bedStyles.finish}>
        <span>Finish Check</span>
        <div>
          <button type="button" className={bedStyles.primaryFinish}>Observation recorded</button>
          <button type="button">Blocked</button>
        </div>
      </footer>
    </article>
  );
}

function SprayCard() {
  return (
    <article className={bedStyles.card}>
      <header className={bedStyles.header}>
        <div className={bedStyles.familyRow}>
          <span>Spray BT</span>
          <small>crop operation</small>
        </div>
        <h2>Barn Bed 2</h2>
        <p>Barn Beds</p>
      </header>

      <Trail steps={sprayTrail} label="Barn Bed 2 cabbage crop Trail" />

      <section className={bedStyles.cropState}>
        <span>Bed now</span>
        <strong>Cabbage</strong>
        <div>
          <b>BT treatment is today’s move</b>
          <b>Follow-up check stays on the same Trail</b>
        </div>
      </section>

      <BedMap cropLabel="Cabbage" />

      <ResourceMethod
        categories={[
          {
            title: "Sprayer bottle",
            items: ["Pump sprayer"],
            issueLabel: "Log a sprayer issue",
          },
          {
            title: "BT",
            items: ["BT concentrate"],
            issueLabel: "Log a BT inventory issue",
          },
          {
            title: "Mix",
            items: ["BT + water · verified product-label rate"],
            note: "The exact verified recipe belongs here with the operation. This specimen intentionally does not invent a rate.",
          },
        ]}
      />

      <section className={bedStyles.results}>
        <header><span>What happened?</span></header>
        <div className={bedStyles.resultPills}>
          <ResultChoice name="spray-result" label="Applied" />
          <ResultChoice name="spray-result" label="Pest pressure heavy" />
          <ResultChoice name="spray-result" label="Crop damage" />
          <NoteDrawer label="Log it" ariaLabel="Add a BT spray note" />
        </div>
      </section>

      <footer className={bedStyles.finish}>
        <span>Finish Spray BT</span>
        <div>
          <button type="button" className={bedStyles.primaryFinish}>Treatment recorded</button>
          <button type="button">Blocked</button>
        </div>
      </footer>
    </article>
  );
}

export function WaterCareCardSpecimen() {
  return (
    <div className={styles.specimenStack}>
      <WaterCard />
      <div className={styles.variantLabel}><span>Same crop/place shell · spray treatment variant</span></div>
      <SprayCard />
    </div>
  );
}

export function CheckCardSpecimen() {
  return <CheckCard />;
}
