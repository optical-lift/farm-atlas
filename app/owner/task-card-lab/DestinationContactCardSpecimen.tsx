import DominionCardFrame from "./DominionCardFrame";
import styles from "./destination-contact-card-specimen.module.css";

const reusableExamples = [
  {
    family: "Store pickup",
    example: "Home Depot curbside order",
    detail: "Store name, address, phone, pickup-window note",
  },
  {
    family: "Return + purchase",
    example: "Walmart or Bomgaars errand",
    detail: "Destination contact plus the return / buy instructions",
  },
  {
    family: "Equipment pickup",
    example: "Hampton’s mower part or borrowed mower",
    detail: "Person or business contact plus handoff notes",
  },
  {
    family: "Vendor pickup",
    example: "Quick Print poster + payment-sign bundle",
    detail: "Vendor contact plus what is ready to collect",
  },
] as const;

export default function DestinationContactCardSpecimen() {
  return (
    <div className={styles.specimen}>
      <DominionCardFrame
        family="Harvest"
        familyDetail="off-site"
        title="Mary’s garden"
        subtitle="Supplemental flowers for the Aug. 27 paid event."
        timing="Morning · 1 hr 45 min max"
      >
        <section className={styles.destinationSection} aria-label="Destination contact">
          <div className={styles.sectionLabel}>Destination</div>
          <div className={styles.contactCard}>
            <div className={styles.contactIdentity}>
              <strong>Mary</strong>
              <address>
                1908 E Farm Road 94<br />
                Springfield, MO 65803
              </address>
            </div>
            <a className={styles.phone} href="tel:+14173807830">(417) 380-7830</a>
          </div>

          <div className={styles.specialNote}>
            <span>Note</span>
            <p>Text Mary from Elm’s Google Voice number before leaving.</p>
          </div>
        </section>

        <section className={styles.workSection}>
          <div className={styles.sectionLabel}>Work</div>
          <p className={styles.primaryInstruction}>Harvest supplemental flowers for the Aug. 27 paid event.</p>
          <div className={styles.timeRoute} aria-label="Travel and work timing">
            <span><b>30 min</b><small>drive there</small></span>
            <span><b>45 min</b><small>harvest</small></span>
            <span><b>30 min</b><small>drive back</small></span>
          </div>
          <p className={styles.secondaryInstruction}>
            Give yourself about 45 minutes to harvest. Keep the visit focused on the work so the full trip stays inside the time limit.
          </p>
        </section>
      </DominionCardFrame>

      <aside className={styles.reusePanel}>
        <div className={styles.reuseHeading}>
          <span>Same template</span>
          <strong>Other destination-based work</strong>
        </div>
        <div className={styles.reuseGrid}>
          {reusableExamples.map((item) => (
            <div className={styles.reuseItem} key={item.family}>
              <span>{item.family}</span>
              <strong>{item.example}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
