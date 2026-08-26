import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

export type TaskDestinationContactData = {
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

export function taskDestinationContact(task: AtlasTaskCard | undefined): TaskDestinationContactData | null {
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
