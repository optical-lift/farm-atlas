import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

import styles from "./task-destination-contact.module.css";

type DestinationContact = {
  name: string | null;
  address: string | null;
  phone: string | null;
  phoneLabel: string;
  note: string | null;
  headerPlace: string | null;
};

function metadataText(task: AtlasTaskCard | undefined, key: string) {
  const value = task?.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLine(value: string) {
  return value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

export function taskDestinationContact(task: AtlasTaskCard | undefined): DestinationContact | null {
  if (!task) return null;

  const name = metadataText(task, "destination_name") || metadataText(task, "contact_name");
  const address = metadataText(task, "destination_address") || metadataText(task, "address");
  const phone = metadataText(task, "destination_phone") || metadataText(task, "phone");
  const phoneLabel = metadataText(task, "destination_phone_label") || "Phone:";
  const note = metadataText(task, "destination_note");
  const headerPlace = metadataText(task, "destination_header") || metadataText(task, "display_location");

  if (!name && !address && !phone && !note) return null;
  return { name, address, phone, phoneLabel, note, headerPlace };
}

export function removeDestinationContactInstructions(
  task: AtlasTaskCard | undefined,
  lines: string[],
) {
  const contact = taskDestinationContact(task);
  if (!contact) return lines;

  const duplicates = new Set<string>();
  if (contact.note) duplicates.add(normalizeLine(contact.note));
  if (contact.phone) {
    duplicates.add(normalizeLine(contact.phone));
    duplicates.add(normalizeLine(`${contact.phoneLabel} ${contact.phone}`));
    if (contact.name) duplicates.add(normalizeLine(`${contact.name} phone: ${contact.phone}`));
  }

  return lines.filter((line) => !duplicates.has(normalizeLine(line)));
}

function AddressLines({ address }: { address: string }) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return <>{address}</>;
  return <>{parts.map((part, index) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 ? <br /> : null}</span>)}</>;
}

export default function TaskDestinationContact({ task }: { task?: AtlasTaskCard }) {
  const contact = taskDestinationContact(task);
  if (!contact) return null;

  return (
    <section className={styles.section} data-atlas-destination-contact="true" aria-label="Destination">
      <span className={styles.label}>Destination</span>
      <div className={styles.card}>
        <div className={styles.identity}>
          {contact.name ? <strong>{contact.name}</strong> : null}
          {contact.address ? <address><AddressLines address={contact.address} /></address> : null}
        </div>
        {contact.phone ? (
          <div className={styles.phone}>
            <span>{contact.phoneLabel}</span>
            <strong>{contact.phone}</strong>
          </div>
        ) : null}
      </div>
      {contact.note ? (
        <div className={styles.note}>
          <span>Note</span>
          <p>{contact.note}</p>
        </div>
      ) : null}
    </section>
  );
}
