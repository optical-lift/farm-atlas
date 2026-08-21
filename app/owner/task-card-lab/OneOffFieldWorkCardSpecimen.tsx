import DominionCardFrame from "./DominionCardFrame";
import localStyles from "./venue-local-rail.module.css";
import venueStyles from "./venue-card-specimen.module.css";

type FieldWorkRow = {
  label: string;
  detail?: string;
  issueLabel?: string;
};

type FieldWorkSection = {
  id: string;
  title: string;
  location?: string;
  rows: FieldWorkRow[];
};

type OneOffFieldWorkCardProps = {
  family: string;
  familyDetail: string;
  title: string;
  subtitle: string;
  timing: string;
  sections: FieldWorkSection[];
  prefix: string;
};

function IssueDrawer({ label }: { label: string }) {
  return (
    <details className={venueStyles.restockDrawer}>
      <summary aria-label={`Report an issue with ${label}`} title={`Report an issue with ${label}`}>
        <span aria-hidden="true">+</span>
      </summary>
      <div className={venueStyles.restockPanel}>
        <button type="button">Report issue</button>
        <label>
          <span>Note</span>
          <input type="text" placeholder="Add note…" />
        </label>
      </div>
    </details>
  );
}

function InstructionRow({ row, id }: { row: FieldWorkRow; id: string }) {
  return (
    <div className={`${venueStyles.reminderRow} ${localStyles.localReminderRow}`}>
      <input className={venueStyles.reminderToggle} id={id} type="checkbox" />
      <label className={venueStyles.reminderCheck} htmlFor={id}>
        <strong>{row.label}</strong>
        {row.detail ? <small>{row.detail}</small> : null}
      </label>
      {row.issueLabel ? <IssueDrawer label={row.issueLabel} /> : null}
    </div>
  );
}

function InstructionSections({ sections, prefix }: { sections: FieldWorkSection[]; prefix: string }) {
  return (
    <div className={venueStyles.stations}>
      {sections.map((section) => (
        <section className={`${venueStyles.station} ${localStyles.localStation}`} key={section.id}>
          <header className={venueStyles.stationHeader}>
            <div>
              <h3>{section.title}</h3>
              {section.location ? <span>{section.location}</span> : null}
            </div>
          </header>
          <div className={venueStyles.resourceList}>
            {section.rows.map((row, index) => (
              <InstructionRow row={row} id={`${prefix}-${section.id}-${index}`} key={`${row.label}-${index}`} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function OneOffFieldWorkCard({ family, familyDetail, title, subtitle, timing, sections, prefix }: OneOffFieldWorkCardProps) {
  return (
    <DominionCardFrame
      family={family}
      familyDetail={familyDetail}
      title={title}
      subtitle={subtitle}
      timing={timing}
    >
      <div className={venueStyles.rowKey} aria-label="One-off field work controls">
        <span>tap to cross off</span>
        <span><b>+</b> report a problem</span>
      </div>
      <InstructionSections sections={sections} prefix={prefix} />
    </DominionCardFrame>
  );
}

const stakeAndStringSections: FieldWorkSection[] = [
  {
    id: "layout",
    title: "Measure + mark",
    location: "Field Rows · Back Half",
    rows: [
      { label: "3 ft bed width" },
      { label: "3 ft walkway width" },
    ],
  },
  {
    id: "stakes",
    title: "Stake",
    rows: [
      { label: "Set wooden stakes at bed ends", issueLabel: "wooden stakes" },
    ],
  },
  {
    id: "string",
    title: "String",
    rows: [
      { label: "Run string along each bed edge", issueLabel: "string" },
      { label: "Keep bed lines straight" },
    ],
  },
];

const garlicSpraySections: FieldWorkSection[] = [
  {
    id: "mix",
    title: "Mix + load",
    rows: [
      { label: "Garlic concentrate", detail: "Use the concentrate label for the mix rate", issueLabel: "garlic concentrate" },
      { label: "Pump sprayer", issueLabel: "pump sprayer" },
    ],
  },
  {
    id: "field-rows",
    title: "Field Rows",
    location: "Deer pressure",
    rows: [
      { label: "Spray vulnerable plants" },
    ],
  },
  {
    id: "upick",
    title: "U-Pick",
    location: "Deer pressure",
    rows: [
      { label: "Spray vulnerable plants" },
    ],
  },
];

export default function OneOffFieldWorkCardSpecimen() {
  return (
    <div className={venueStyles.venueSpecimen}>
      <OneOffFieldWorkCard
        family="Setup"
        familyDetail="one-off field work"
        title="Stake + String Beds"
        subtitle="Field Rows · Back Half"
        timing="Do once · then leave the Day"
        sections={stakeAndStringSections}
        prefix="stake-string"
      />

      <div className={venueStyles.nextVariantLabel}><span>Same one-off instructional grammar · different operation</span></div>

      <OneOffFieldWorkCard
        family="Protect"
        familyDetail="one-off field work"
        title="Spray Garlic Deer Deterrent"
        subtitle="Field Rows + U-Pick"
        timing="As needed · deer pressure"
        sections={garlicSpraySections}
        prefix="garlic-spray"
      />

      <aside className={venueStyles.templateTruth}>
        <span>One-off field-work grammar · owner-only note</span>
        <p>These tasks borrow Venue’s instructional station-and-resource body because the Worker is moving through a physical setup or protection job. They do not receive a Project Trail or a persistent lifecycle merely because the work has several sections.</p>
        <p>The task appears when the work is actually needed, carries only the current place/instructions/resources, and disappears after completion. The same body grammar can support other one-off layout, protection, installation, or reset work without creating a bespoke task-card species for each job.</p>
      </aside>
    </div>
  );
}
