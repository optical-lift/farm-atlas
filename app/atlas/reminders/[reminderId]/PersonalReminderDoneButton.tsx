"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "../../person-atlas-form.module.css";

export default function PersonalReminderDoneButton({ reminderId }: { reminderId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function complete() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/atlas/person-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "complete", reminderId }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Atlas could not complete that reminder.");
      router.push("/atlas");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Atlas could not complete that reminder.");
      setSaving(false);
    }
  }

  return (
    <>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.action} type="button" disabled={saving} onClick={() => void complete()}>
        {saving ? "Recording…" : "Done"}
      </button>
    </>
  );
}
