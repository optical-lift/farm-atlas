import DominionCardFrame from "./DominionCardFrame";
import styles from "./mg11-reference-polygon-specimen.module.css";

const ACTIVE_CROPS = [
  "Sedum",
  "Chives",
  "Beans",
  "Zinnia",
  "Kale",
  "Container zucchini",
] as const;

const WEDGES = [
  { key: "MG11", points: "80,80 210,25 210,118 164,164", labelX: 151, labelY: 91 },
  { key: "MG1", points: "210,25 340,80 256,164 210,118", labelX: 269, labelY: 91 },
  { key: "MG2", points: "340,80 395,210 302,210 256,164", labelX: 333, labelY: 151 },
  { key: "MG4", points: "395,210 340,340 256,256 302,210", labelX: 333, labelY: 274 },
  { key: "MG5", points: "340,340 210,395 210,302 256,256", labelX: 269, labelY: 337 },
  { key: "MG7", points: "210,395 80,340 164,256 210,302", labelX: 151, labelY: 337 },
  { key: "MG8", points: "80,340 25,210 118,210 164,256", labelX: 86, labelY: 274 },
  { key: "MG10", points: "25,210 80,80 164,164 118,210", labelX: 86, labelY: 151 },
] as const;

const CLOCK_MARKS = [
  { label: "12", x: 210, y: 12, anchor: "middle" },
  { label: "1:30", x: 355, y: 70, anchor: "start" },
  { label: "3", x: 411, y: 214, anchor: "start" },
  { label: "4:30", x: 355, y: 360, anchor: "start" },
  { label: "6", x: 210, y: 416, anchor: "middle" },
  { label: "7:30", x: 65, y: 360, anchor: "end" },
  { label: "9", x: 9, y: 214, anchor: "end" },
  { label: "10:30", x: 65, y: 70, anchor: "end" },
] as const;

export default function MG11ReferencePolygonSpecimen() {
  return (
    <div
      className={styles.specimen}
      data-atlas-task-card-lab-fixture="mg11-reference-polygon"
      data-live-task-binding="none"
    >
      <div className={styles.fixtureBanner}>
        <strong>EDITOR FIXTURE</strong>
        <span>No live task · no farm-state writes</span>
      </div>

      <DominionCardFrame
        family="Weed"
        familyDetail="reference-map study"
        title="MG11"
        subtitle="Main Garden · north / back of garden"
        timing="Task Card Editor only"
        completion={false}
      >
        <section className={styles.mapSection} aria-labelledby="mg11-reference-map-heading">
          <header className={styles.sectionHeader}>
            <div>
              <span>Reference map</span>
              <strong id="mg11-reference-map-heading">Main Garden clock face</strong>
            </div>
            <small>MG11 highlighted</small>
          </header>

          <div className={styles.orientationTop}>North / back of garden</div>
          <svg
            className={styles.map}
            viewBox="-28 -10 476 450"
            role="img"
            aria-label="Reference diagram of the Main Garden. MG11 is the wedge between the 10:30 and 12 o'clock walkways. The center is a large diamond clock face."
          >
            <rect className={styles.mapGround} x="20" y="20" width="380" height="380" rx="24" />
            {WEDGES.map((wedge) => (
              <g key={wedge.key}>
                <polygon
                  className={wedge.key === "MG11" ? styles.activeWedge : styles.wedge}
                  points={wedge.points}
                />
                <text className={wedge.key === "MG11" ? styles.activeWedgeLabel : styles.wedgeLabel} x={wedge.labelX} y={wedge.labelY} textAnchor="middle">
                  {wedge.key}
                </text>
              </g>
            ))}

            <polygon className={styles.centerDiamond} points="210,118 302,210 210,302 118,210" />
            <text className={styles.centerLabel} x="210" y="198" textAnchor="middle">Center</text>
            <text className={styles.centerLabel} x="210" y="216" textAnchor="middle">Diamond /</text>
            <text className={styles.centerLabel} x="210" y="234" textAnchor="middle">Clock Face</text>

            {CLOCK_MARKS.map((mark) => (
              <text
                className={styles.clockMark}
                key={mark.label}
                x={mark.x}
                y={mark.y}
                textAnchor={mark.anchor}
              >
                {mark.label}
              </text>
            ))}
          </svg>
          <div className={styles.orientationBottom}>Front / Oak tree side · stand here pointing toward MG5</div>
        </section>

        <section className={styles.cropSection} aria-label="MG11 active crops awaiting map placement">
          <header className={styles.sectionHeader}>
            <div>
              <span>Active crops</span>
              <strong>Placement not recorded in the reference sketch</strong>
            </div>
            <small>Do not guess</small>
          </header>
          <div className={styles.cropList}>
            {ACTIVE_CROPS.map((crop) => (
              <div className={styles.cropRow} key={crop}>
                <strong>{crop}</strong>
                <span>unmapped</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.resultSection} aria-label="Weed result controls shown for layout only">
          <header className={styles.sectionHeader}>
            <div><span>How’d we do?</span></div>
            <small>layout only</small>
          </header>
          <div className={styles.resultPills}>
            <button type="button" disabled>Still rough</button>
            <button type="button" disabled>Mostly clear</button>
            <button type="button" disabled>Log it</button>
          </div>
        </section>
      </DominionCardFrame>
    </div>
  );
}
