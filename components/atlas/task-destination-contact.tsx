import type { TaskDestinationContactData } from "@/lib/atlas/task-destination-contact";

import styles from "./task-destination-contact.module.css";

function AddressLines({ address }: { address: string }) {
  const comma = address.indexOf(",");
  if (comma < 0) return <>{address}</>;
  const first = address.slice(0, comma).trim();
  const rest = address.slice(comma + 1).trim();
  return <>{first}<br />{rest}</>;
}

export default function TaskDestinationContact({ destination }: { destination: TaskDestinationContactData | null | undefined }) {
  if (!destination) return null;

  const handoffLabel = destination.contactName ? "Ask for" : "Handoff";

  return (
    <section className={styles.section} data-atlas-destination-contact="true" aria-label="Destination contact">
      <div className={styles.label}>Destination</div>
      <div className={styles.card}>
        <div className={styles.identity}>
          {destination.name ? <strong>{destination.name}</strong> : null}
          {destination.address ? <address><AddressLines address={destination.address} /></address> : null}
        </div>
        {destination.contactName || destination.handoffInstruction ? (
          <div className={styles.handoff} data-atlas-destination-handoff="true">
            <span>{handoffLabel}</span>
            {destination.contactName ? <strong>{destination.contactName}</strong> : null}
            {destination.handoffInstruction ? <p>{destination.handoffInstruction}</p> : null}
          </div>
        ) : null}
        {destination.phone ? (
          <div className={styles.phone}>
            <span>{destination.phoneLabel}</span>
            <strong>{destination.phone}</strong>
          </div>
        ) : null}
      </div>
      {destination.note ? (
        <div className={styles.note}>
          <span>Note</span>
          <p>{destination.note}</p>
        </div>
      ) : null}
    </section>
  );
}
