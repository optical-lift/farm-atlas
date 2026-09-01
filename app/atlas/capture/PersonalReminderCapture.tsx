"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import styles from "../person-atlas-form.module.css";

export default function PersonalReminderCapture() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!label.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/atlas/person-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "create",
          label,
          note,
          dueDate: dueDate || null,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Atlas could not remember that.");
      router.push("/atlas");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Atlas could not remember that.");
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>
        <span>Remember</span>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={240}
          required
          autoFocus
          placeholder="Clean the toilet"
        />
      </label>
      <label className={styles.field}>
        <span>When, if it matters</span>
        <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Note, if useful</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button className={styles.action} type="submit" disabled={saving || !label.trim()}>
        {saving ? "Remembering…" : "Remember this"}
      </button>
    </form>
  );
}
