import DominionCardFrame from "./DominionCardFrame";
import styles from "./pickup-handoff-card-specimen.module.css";

const orders = [
  {
    number: "0001",
    time: "2:30 PM",
    payment: "Unpaid",
    items: ["2× DIY Build-Your-Own Bouquet Buckets"],
  },
  {
    number: "0002",
    time: "4:00 PM",
    payment: "Paid",
    items: ["2× Sunflower bundles", "1× Zinnia bundle"],
  },
  {
    number: "0003",
    time: "5:30 PM",
    payment: "Paid",
    items: ["1× Wrapped posy", "1× Goldenrod bundle"],
  },
] as const;

export default function PickupHandoffCardSpecimen() {
  return (
    <DominionCardFrame
      family="Pickup / Handoff"
      familyDetail="order dock"
      title="Pickup Dock"
      subtitle="Today’s pickup clipboard · Elm Farm"
      timing="Today · 3 orders"
      completion={
        <div className={styles.completion}>
          <button type="button" className={styles.primaryCompletion}>Dock clear</button>
          <button type="button">Pickup outstanding</button>
        </div>
      }
    >
      <section className={styles.dockSection}>
        <header className={styles.dockHeader}>
          <div>
            <span className={styles.sectionLabel}>Orders</span>
            <strong>Ready for pickup</strong>
          </div>
          <small>Clipboard</small>
        </header>

        <div className={styles.orderList}>
          {orders.map((order) => (
            <article className={styles.orderRow} key={order.number}>
              <div className={styles.orderTopline}>
                <div className={styles.orderIdentity}>
                  <strong>#{order.number}</strong>
                  <span>{order.time}</span>
                </div>
                <span className={order.payment === "Paid" ? styles.paidPill : styles.unpaidPill}>
                  {order.payment}
                </span>
              </div>

              <ul className={styles.itemList}>
                {order.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <aside className={styles.previewNote}>
        <strong>Mockup only</strong>
        <span>#0001 reflects the described 2:30 pickup. #0002 and #0003 are fixture rows to show clipboard density. No reservation, inventory, payment, scheduling, or Worker Day behavior is wired.</span>
      </aside>
    </DominionCardFrame>
  );
}
