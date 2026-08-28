import DominionCardFrame from "./DominionCardFrame";
import styles from "./pickup-handoff-card-specimen.module.css";

export default function PickupHandoffCardSpecimen() {
  return (
    <DominionCardFrame
      family="Pickup / Handoff"
      familyDetail="reserved saleable output"
      title="Customer Pickup"
      subtitle="Elm Farm · exact finished goods attached"
      timing="Today · 2:30 PM"
      completion={
        <div className={styles.completion}>
          <button type="button" className={styles.primaryCompletion}>Picked Up</button>
          <button type="button">Not picked up</button>
        </div>
      }
    >
      <section className={styles.section}>
        <span className={styles.sectionLabel}>Customer</span>
        <div className={styles.customerRow}>
          <div>
            <strong>Customer name</strong>
            <small>Pickup at Elm Farm</small>
          </div>
          <span>2:30 PM</span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionLabel}>Reserved items</span>
            <strong>Attached from confirmed Condition + Bunch output</strong>
          </div>
          <span className={styles.lockedBadge}>Reserved</span>
        </div>

        <div className={styles.outputLine}>
          <span className={styles.quantity}>2×</span>
          <div>
            <strong>DIY Build-Your-Own Bouquet Buckets</strong>
            <small>Confirmed output · 2 of 2 reserved for this pickup</small>
          </div>
        </div>

        <div className={styles.inventoryTruth}>
          <span><strong>2</strong> made</span>
          <span><strong>2</strong> reserved</span>
          <span><strong>0</strong> available</span>
        </div>
        <p className={styles.helper}>The worker sees the attached finished-good line, not a retyped description of “two buckets.”</p>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Payment</span>
        <div className={styles.segmented} aria-label="Payment status preview">
          <button type="button" className={styles.segmentActive}>Due</button>
          <button type="button">Paid</button>
          <button type="button">Complimentary</button>
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.sectionLabel}>Pickup notes</span>
        <div className={styles.notes}>Add gate, vehicle, handoff, or customer-specific notes here.</div>
      </section>

      <aside className={styles.previewNote}>
        <strong>Mockup only</strong>
        <span>No reservation, inventory, payment, scheduling, or Worker Day behavior is wired from this specimen.</span>
      </aside>
    </DominionCardFrame>
  );
}
