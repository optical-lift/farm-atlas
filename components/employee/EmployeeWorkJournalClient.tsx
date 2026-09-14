"use client";

import { useMemo, useState } from "react";

import type {
  EmployeeWorkJournalDay,
  EmployeeWorkJournalEntry,
} from "@/lib/employee-work-journal";
import styles from "./EmployeeWorkJournal.module.css";

type EmployeeWorkJournalClientProps = {
  journal: EmployeeWorkJournalDay;
  canEdit: boolean;
  busy: boolean;
  error?: string | null;
  onToggleComplete: (entry: EmployeeWorkJournalEntry) => void | Promise<void>;
  onToggleAttention: (entry: EmployeeWorkJournalEntry) => void | Promise<void>;
  onAddReportedWork: (title: string) => void | Promise<void>;
};

function displayTime(localTime: string | null) {
  if (!localTime) return null;
  const [hour, minute] = localTime.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return localTime;
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function stateLabel(entry: EmployeeWorkJournalEntry) {
  if (entry.state === "complete") return "Done";
  if (entry.state === "reported_complete") return "Reported · awaiting review";
  if (entry.state === "active") return "In progress";
  if (entry.carried) return `Carried from ${entry.originalPlannedDate}`;
  return null;
}

function JournalMark({ entry }: { entry: EmployeeWorkJournalEntry }) {
  const complete = entry.state === "complete" || entry.state === "reported_complete";
  return (
    <svg className={styles.mark} viewBox="0 0 22 22" aria-hidden="true">
      {complete ? (
        <>
          <circle cx="11" cy="11" r="7.25" fill="#181713" opacity={entry.state === "complete" ? ".78" : ".46"} />
          {entry.state === "reported_complete" ? (
            <circle cx="11" cy="11" r="9" fill="none" stroke="#181713" strokeWidth=".7" opacity=".32" />
          ) : null}
        </>
      ) : (
        <path
          d="M5.3 11.3c.2-4.1 3.1-7.2 6.8-7.1 3.9.1 6.7 3.3 6.3 7.1-.4 3.8-3.4 6.7-7.2 6.5-3.9-.2-6.1-3.1-5.9-6.5Z"
          fill="none"
          stroke="#181713"
          strokeWidth="1.05"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export default function EmployeeWorkJournalClient({
  journal,
  canEdit,
  busy,
  error,
  onToggleComplete,
  onToggleAttention,
  onAddReportedWork,
}: EmployeeWorkJournalClientProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [reportedTitle, setReportedTitle] = useState("");

  const selectedEntry = useMemo(
    () => journal.entries.find((entry) => entry.id === selectedId) ?? null,
    [journal.entries, selectedId],
  );

  async function addReportedWork() {
    const title = reportedTitle.trim();
    if (!title || busy) return;
    await onAddReportedWork(title);
    setReportedTitle("");
    setComposerOpen(false);
  }

  return (
    <>
      <div className={styles.shape} aria-label="Shape of the day">
        {journal.shape.summaryLine}
      </div>

      <section className={styles.entries} aria-label="Work Journal entries">
        {journal.entries.map((entry) => {
          const complete = entry.state === "complete" || entry.state === "reported_complete";
          const label = stateLabel(entry);
          const time = displayTime(entry.timeLabel);

          return (
            <article
              key={entry.key}
              className={`${styles.entry}${complete ? ` ${styles.entryComplete}` : ""}`}
              data-work-journal-entry-id={entry.id}
            >
              {canEdit && !entry.completion.institutionallyComplete ? (
                <button
                  type="button"
                  disabled={busy}
                  className={styles.markButton}
                  aria-label={complete ? `Reopen ${entry.title}` : `Mark ${entry.title} done`}
                  onClick={() => void onToggleComplete(entry)}
                >
                  <JournalMark entry={entry} />
                </button>
              ) : (
                <span className={styles.markStatic}>
                  <JournalMark entry={entry} />
                </span>
              )}

              <button
                type="button"
                className={styles.entryButton}
                aria-label={`Open journal entry ${entry.title}`}
                onClick={() => setSelectedId(entry.id)}
              >
                <span className={styles.entryHeading}>
                  <span className={styles.entryTitle}>{entry.title}</span>
                  {time ? <span className={styles.entryTime}>{time}</span> : null}
                </span>

                {entry.guidance.length ? (
                  <span className={styles.entryGuidance}>
                    {entry.guidance.slice(0, 2).map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                ) : null}

                {label ? <span className={styles.entryMeta}>{label}</span> : null}
              </button>

              {canEdit && !complete ? (
                <button
                  type="button"
                  disabled={busy}
                  className={styles.attentionButton}
                  aria-label={entry.state === "active" ? `Stop working on ${entry.title}` : `Work on ${entry.title}`}
                  onClick={() => void onToggleAttention(entry)}
                >
                  {entry.state === "active" ? <span className={styles.attentionMark} aria-hidden="true" /> : null}
                </button>
              ) : entry.state === "active" ? (
                <span className={styles.attentionMark} aria-hidden="true" />
              ) : (
                <span aria-hidden="true" />
              )}
            </article>
          );
        })}
      </section>

      {journal.reportedEntries.length ? (
        <section className={styles.reportedSection} aria-label="Recorded today">
          <div className={styles.reportedLabel}>Recorded today</div>
          {journal.reportedEntries.map((entry) => (
            <div className={styles.reportedEntry} key={entry.key}>
              {entry.title}
            </div>
          ))}
        </section>
      ) : null}

      {canEdit ? (
        <div className={styles.addArea}>
          {composerOpen ? (
            <div className={styles.composer}>
              <input
                autoFocus
                className={styles.lineInput}
                value={reportedTitle}
                onChange={(event) => setReportedTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addReportedWork();
                  }
                }}
                placeholder="What else happened today?"
                aria-label="Add work completed today"
              />
              <div className={styles.composerActions}>
                <button
                  type="button"
                  className={styles.textButton}
                  disabled={busy || !reportedTitle.trim()}
                  onClick={() => void addReportedWork()}
                >
                  Add
                </button>
                <button
                  type="button"
                  className={styles.textButton}
                  disabled={busy}
                  onClick={() => {
                    setComposerOpen(false);
                    setReportedTitle("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.textButton}
              disabled={busy}
              onClick={() => setComposerOpen(true)}
            >
              + Add something I did
            </button>
          )}
        </div>
      ) : null}

      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={`${styles.drawerViewport}${selectedEntry ? ` ${styles.drawerOpen}` : ""}`}>
        <section className={styles.drawer} aria-label={selectedEntry?.title ?? "Journal entry"}>
          <button
            type="button"
            className={styles.entryButton}
            onClick={() => setSelectedId(null)}
            aria-label="Close journal entry"
          >
            <span className={styles.drawerHandle} aria-hidden="true" />
          </button>

          {selectedEntry ? (
            <>
              <div className={styles.drawerLabel}>Journal entry</div>
              <div className={styles.drawerTitle}>{selectedEntry.title}</div>

              {selectedEntry.guidance.length ? (
                <div className={styles.drawerDetails}>
                  {selectedEntry.guidance.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              ) : null}

              <div className={styles.drawerMeta}>
                {displayTime(selectedEntry.timeLabel)
                  ? `${displayTime(selectedEntry.timeLabel)} · `
                  : ""}
                {stateLabel(selectedEntry) ?? "Assigned today"}
              </div>

              {canEdit && !selectedEntry.completion.institutionallyComplete ? (
                <div className={styles.drawerActions}>
                  <button
                    type="button"
                    className={styles.drawerAction}
                    disabled={busy}
                    onClick={() => void onToggleComplete(selectedEntry)}
                  >
                    {selectedEntry.state === "reported_complete" ? "Reopen" : "Done"}
                  </button>
                  {selectedEntry.state !== "reported_complete" ? (
                    <button
                      type="button"
                      className={styles.drawerAction}
                      disabled={busy}
                      onClick={() => void onToggleAttention(selectedEntry)}
                    >
                      {selectedEntry.state === "active" ? "Stop working" : "Work on this"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
