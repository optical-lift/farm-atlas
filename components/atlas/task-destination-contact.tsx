import type { TaskDestinationContactData } from "@/lib/atlas/task-destination-contact";

import styles from "./task-destination-contact.module.css";

function AddressLines({ address }: { address: string }) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return <>{address}</>;
  return <>{parts.map((part, index) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 ? <br /> : null}</span>)}</>;
}

export default function TaskDestinationContact({ destination }: { destination: TaskDestinationContactData | null | undefined }) {
  if (!destination) return null;

  return (
    <section className={styles.section} data-atlas-destination-contact="true" aria-label="Destination">
      <span className={styles.label}>Destination</span>
      <div className={styles.card}>
        <div className={styles.identity}>
          {destination.name ? <strong>{destination.name}</strong> : null}
          {destination.address ? <address><AddressLines address={destination.address} /></address> : null}
        </div>
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
