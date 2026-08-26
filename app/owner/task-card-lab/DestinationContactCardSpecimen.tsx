import TaskDestinationContact from "@/components/atlas/task-destination-contact";
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

const maryDestination = {
  name: "Mary",
  address: "1908 E Farm Road 94, Springfield, MO 65803",
  phone: "(417) 380-7830",
  phoneLabel: "Call from Google Voice:",
  note: "Text Mary from Elm’s Google Voice number before leaving.",
  headerPlace: "Mary’s garden · Springfield",
};

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
        <TaskDestinationContact destination={maryDestination} />
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
