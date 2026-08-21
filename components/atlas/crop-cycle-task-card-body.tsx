import styles from "./crop-cycle-task-card-body.module.css";

export type CropCycleTrailStep = {
  label: string;
  detail: string;
  state: "done" | "now" | "later";
};

export type CropCycleCardState = {
  crop: string;
  stage?: string | null;
  harvest?: string | null;
  trail: CropCycleTrailStep[];
  trailLabel: string;
};

export default function CropCycleTaskCardBody({ state }: { state: CropCycleCardState }) {
  return (
    <>
      <div
        className={styles.trail}
        style={{ gridTemplateColumns: `repeat(${Math.max(2, state.trail.length)}, minmax(0, 1fr))` }}
        aria-label={state.trailLabel}
      >
        {state.trail.map((step) => (
          <span
            className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater}
            key={`${step.label}-${step.detail}`}
          >
            <b>{step.label}</b>
            <small>{step.detail}</small>
          </span>
        ))}
      </div>

      <section className={styles.cropState}>
        <span>Bed now</span>
        <strong>{state.crop}</strong>
        {state.stage || state.harvest ? (
          <div>
            {state.stage ? <b>{state.stage}</b> : null}
            {state.harvest ? <b>{state.harvest}</b> : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
