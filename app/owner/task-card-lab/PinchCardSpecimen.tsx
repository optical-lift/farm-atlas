import bedStyles from "./weed-card-specimen.module.css";
import weedExtras from "./weed-turnover-additions.module.css";
import styles from "./crop-care-card-specimen.module.css";

const trail = [
  { label: "Transplanted", detail: "Aug 17", state: "done" },
  { label: "Established", detail: "Aug 23", state: "done" },
  { label: "Pinch", detail: "today", state: "now" },
  { label: "Branching check", detail: "next", state: "later" },
  { label: "Harvest", detail: "later", state: "later" },
] as const;

const mapBlocks = Array.from({ length: 10 }, (_, index) => ({ start: index * 3, end: (index + 1) * 3 }));

export default function PinchCardSpecimen() {
  return (
    <article className={bedStyles.card}>
      <header className={bedStyles.header}>
        <div className={bedStyles.familyRow}><span>Pinch</span><small>crop operation</small></div>
        <h2>Curve Garden Bed 3</h2>
        <p>Curve Garden</p>
      </header>

      <div className={bedStyles.trail} aria-label="Curve Garden Bed 3 zinnia crop Trail">
        {trail.map((step) => (
          <span className={step.state === "done" ? bedStyles.trailDone : step.state === "now" ? bedStyles.trailNow : bedStyles.trailLater} key={step.label}>
            <b>{step.label}</b><small>{step.detail}</small>
          </span>
        ))}
      </div>

      <section className={bedStyles.cropState}>
        <span>Bed now</span>
        <strong>Benary’s Giant White zinnia</strong>
        <div><b>Established</b><b>Pinch is today’s move</b></div>
      </section>

      <section className={bedStyles.bedMap}>
        <header><span>Bed map</span><small>3 ft × 30 ft</small></header>
        <div className={weedExtras.mapOrientation}>↑ back fence this side</div>
        <div className={bedStyles.bedRectangle} aria-label="Zinnia bed occupancy map">
          {mapBlocks.map((block, blockIndex) => (
            <button type="button" className={blockIndex < 7 ? bedStyles.mapBlockActive : bedStyles.mapBlock} key={block.start} aria-label={`Feet ${block.start} to ${block.end}`}>
              {Array.from({ length: 9 }, (_, squareIndex) => <span key={squareIndex}>o</span>)}
            </button>
          ))}
        </div>
        <div className={bedStyles.mapScale}><span>0 ft</span><span>15 ft</span><span>30 ft</span></div>
        <div className={bedStyles.mapDetail}><span>0–21 ft</span><strong>Plants ready to pinch</strong><small>The remaining section can stay on the same bed Trail and receive its Pinch move when it reaches the right stage.</small></div>
      </section>

      <section className={bedStyles.results}>
        <header><span>What happened?</span></header>
        <div className={bedStyles.resultPills}>
          {["Pinched", "Part not ready", "Plant loss"].map((label) => (
            <label className={bedStyles.resultPill} key={label}>
              <input type="radio" name="pinch-result" /><span>{label}</span>
            </label>
          ))}
          <details className={bedStyles.logDrawer}>
            <summary>Log it</summary>
            <div className={bedStyles.logPanel}><input type="text" placeholder="Add note…" aria-label="Add a pinching note" /><button type="button">Save note</button></div>
          </details>
        </div>
      </section>

      <footer className={bedStyles.finish}>
        <span>Finish Pinch</span>
        <div><button type="button" className={bedStyles.primaryFinish}>Ready plants pinched</button><button type="button">Blocked</button></div>
      </footer>
    </article>
  );
}
