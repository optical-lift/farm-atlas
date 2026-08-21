import TaskRecipeDisclosure from "@/components/atlas/task-recipe-disclosure";

import DominionCardFrame from "./DominionCardFrame";
import harvestStyles from "./harvest-card-specimen.module.css";
import styles from "./field-work-card-specimen.module.css";
import venueStyles from "./venue-card-specimen.module.css";

type Tool = {
  label: string;
  restock?: boolean;
};

type SprayArea = {
  label: string;
  lastSprayed: string;
  preselected?: boolean;
};

function RestockDrawer({ label }: { label: string }) {
  return (
    <details className={venueStyles.restockDrawer}>
      <summary aria-label={`Request more ${label}`} title={`Request more ${label}`}>
        <span aria-hidden="true">+</span>
      </summary>
      <div className={venueStyles.restockPanel}>
        <button type="button">Restock</button>
        <label><span>Note</span><input type="text" placeholder="Add note…" /></label>
      </div>
    </details>
  );
}

function Tools({ tools, prefix }: { tools: Tool[]; prefix: string }) {
  return (
    <section className={styles.tools} aria-label="Tools">
      <header><span>Tools</span></header>
      <div className={styles.toolRows}>
        {tools.map((tool, index) => (
          <div className={styles.toolRow} key={tool.label}>
            <strong>{tool.label}</strong>
            {tool.restock ? <RestockDrawer label={tool.label} /> : null}
            <input className={styles.hiddenMarker} aria-hidden="true" tabIndex={-1} id={`${prefix}-${index}`} />
          </div>
        ))}
      </div>
    </section>
  );
}

function SprayAreas({ areas }: { areas: SprayArea[] }) {
  return (
    <section className={harvestStyles.harvestList} aria-label="Deer deterrent areas">
      <div className={harvestStyles.listKey}>
        <span>Areas</span>
        <small>tap what gets sprayed today</small>
      </div>
      <div className={harvestStyles.zoneRows}>
        {areas.map((area) => (
          <label className={`${harvestStyles.cropRow} ${styles.areaRow}`} key={area.label}>
            <span className={harvestStyles.cropText}>
              <strong>{area.label}</strong>
              <small>{area.lastSprayed}</small>
            </span>
            <input type="checkbox" defaultChecked={area.preselected} aria-label={`Spray ${area.label} today`} />
          </label>
        ))}
      </div>
    </section>
  );
}

const stakingTools: Tool[] = [
  { label: "Wooden stakes", restock: true },
  { label: "String", restock: true },
  { label: "Scissors" },
  { label: "Measuring tape" },
];

const deerTools: Tool[] = [
  { label: "Garlic concentrate", restock: true },
  { label: "Pump sprayer" },
  { label: "Measuring cup" },
  { label: "Water" },
];

const sprayAreas: SprayArea[] = [
  { label: "Field Rows", lastSprayed: "Beds 11–18 · last sprayed Aug 17", preselected: true },
  { label: "U-Pick", lastSprayed: "Beds 1–14 · last sprayed Aug 17", preselected: true },
  { label: "Barn Beds", lastSprayed: "No spray logged" },
  { label: "Berry Walk", lastSprayed: "No spray logged" },
  { label: "Main Garden", lastSprayed: "No spray logged" },
  { label: "Curve Garden", lastSprayed: "No spray logged" },
  { label: "Follow-Me Arches", lastSprayed: "No spray logged" },
  { label: "Strawberry + Dahlia Orchard", lastSprayed: "No spray logged" },
  { label: "Entry Billboard Garden", lastSprayed: "No spray logged" },
];

export default function OneOffFieldWorkCardSpecimen() {
  return (
    <div className={venueStyles.venueSpecimen}>
      <DominionCardFrame
        family="Setup"
        title="Stake + String Beds"
        subtitle="Field Rows · Back Half · 3 ft beds · 3 ft walkways"
      >
        <Tools tools={stakingTools} prefix="stake-string-tool" />
      </DominionCardFrame>

      <div className={venueStyles.nextVariantLabel}><span>Same simple resource grammar · protection task</span></div>

      <DominionCardFrame
        family="Protect"
        title="Spray Garlic Deer Deterrent"
        subtitle="Elm Farm"
      >
        <div className={styles.recipeRow}>
          <TaskRecipeDisclosure>
            <p>Mix garlic concentrate with water using the dilution rate on the current product label.</p>
            <p>Mix in the pump sprayer before spraying the selected areas.</p>
          </TaskRecipeDisclosure>
        </div>
        <Tools tools={deerTools} prefix="deer-tool" />
        <SprayAreas areas={sprayAreas} />
      </DominionCardFrame>
    </div>
  );
}
