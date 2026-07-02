"use client";

import React, { useEffect, useMemo, useState } from "react";

import {
  fetchAtlasTaskCards,
  type AtlasTaskCard,
} from "@/lib/atlas/task-cards-client";
import {
  saveAtlasTaskResult,
  type AtlasTaskResult,
} from "@/lib/atlas/task-result-client";

type TaskFilter = "open" | "today" | "done" | "blocked" | "all";

type ZoneOption = {
  key: string;
  label: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";

  const date = new Date(`${dateIso}T12:00:00`);

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function statusLabel(status: string) {
  if (status === "done") return "Done";
  if (status === "blocked") return "Blocked";
  if (status === "skipped") return "Skipped";
  return "Open";
}

function resultButtonLabel(result: AtlasTaskResult) {
  if (result === "done") return "Done";
  if (result === "partial") return "Partly done";
  if (result === "changed") return "Changed plan/data";
  if (result === "blocked") return "Could not do";
  return "Need supplies";
}

function resultSuccessMessage(result: AtlasTaskResult) {
  if (result === "done") return "Saved as done.";
  if (result === "partial") return "Saved partial progress. The task stays open.";
  if (result === "changed") return "Saved the changed field truth. The task stays open.";
  if (result === "blocked") return "Saved as blocked.";
  return "Saved supply need and created a follow-up task.";
}

function taskSortValue(card: AtlasTaskCard) {
  const statusWeight = card.status === "open" ? 0 : card.status === "blocked" ? 1 : 2;
  const date = card.due_date ?? "9999-12-31";
  return `${statusWeight}-${date}-${card.priority}-${card.title}`;
}

function uniqueZones(cards: AtlasTaskCard[]): ZoneOption[] {
  const map = new Map<string, string>();

  cards.forEach((card) => {
    if (card.zone_key) {
      map.set(card.zone_key, card.zone_label ?? card.zone_key);
    }
  });

  return Array.from(map.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function noteLines(note: string | null | undefined) {
  return (note ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function AtlasHomePage() {
  const [cards, setCards] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [selectedCard, setSelectedCard] = useState<AtlasTaskCard | null>(null);
  const [resultNote, setResultNote] = useState("");
  const [createdBy, setCreatedBy] = useState("anna");
  const [savingResult, setSavingResult] = useState<AtlasTaskResult | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const today = todayIso();

  async function loadCards() {
    try {
      setLoading(true);
      setError(null);

      const response = await fetchAtlasTaskCards();
      const nextCards = response.taskCards ?? [];

      setCards(nextCards);
      return nextCards;
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Atlas could not load tasks.";
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCards();
  }, []);

  const zones = useMemo(() => uniqueZones(cards), [cards]);

  const counts = useMemo(() => {
    return {
      open: cards.filter((card) => card.status === "open").length,
      due: cards.filter(
        (card) => card.status === "open" && card.due_date && card.due_date <= today,
      ).length,
      done: cards.filter((card) => card.status === "done").length,
      blocked: cards.filter((card) => card.status === "blocked").length,
    };
  }, [cards, today]);

  const visibleCards = useMemo(() => {
    return [...cards]
      .filter((card) => {
        if (zoneFilter !== "all" && card.zone_key !== zoneFilter) return false;
        if (filter === "open") return card.status === "open";
        if (filter === "today") {
          return card.status === "open" && !!card.due_date && card.due_date <= today;
        }
        if (filter === "done") return card.status === "done";
        if (filter === "blocked") return card.status === "blocked";
        return true;
      })
      .sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
  }, [cards, filter, today, zoneFilter]);

  function openCard(card: AtlasTaskCard) {
    setSelectedCard(card);
    setResultNote("");
    setResultMessage(null);
  }

  async function handleTaskResult(result: AtlasTaskResult) {
    if (!selectedCard) return;

    const cleanNote = resultNote.trim();

    if (result !== "done" && !cleanNote) {
      setResultMessage(
        "Add one sentence about what happened so the farm truth is not lost.",
      );
      return;
    }

    try {
      setSavingResult(result);
      setResultMessage(null);

      await saveAtlasTaskResult({
        taskId: selectedCard.task_id,
        result,
        note: cleanNote || undefined,
        createdBy: createdBy.trim() || "anna",
      });

      const nextCards = await loadCards();
      const refreshedCard =
        nextCards.find((card) => card.task_id === selectedCard.task_id) ?? null;

      setSelectedCard(refreshedCard);
      setResultNote("");
      setResultMessage(resultSuccessMessage(result));
    } catch (saveError) {
      setResultMessage(
        saveError instanceof Error ? saveError.message : "Atlas could not save that result.",
      );
    } finally {
      setSavingResult(null);
    }
  }

  const primaryTask = visibleCards[0] ?? null;

  return (
    <main className="atlas-phone-shell">
      <section className="atlas-phone">
        <header className="atlas-phone-top">
          <div className="atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Anna Task Hand</span>
          </div>

          <button
            type="button"
            className="atlas-soft-badge"
            onClick={() => void loadCards()}
            style={{ border: 0, cursor: "pointer" }}
          >
            Refresh
          </button>
        </header>

        <div className="atlas-phone-body">
          <section className="atlas-hero-compact atlas-hero-restored">
            <div className="atlas-zone-hero">
              <span className="atlas-phone-kicker" style={{ color: "rgba(255,255,255,.72)" }}>
                Today
              </span>

              <h1 className="atlas-zone-name" style={{ marginTop: 4 }}>
                Do the next clear thing.
              </h1>

              <p style={{ margin: "8px 0 0", color: "rgba(255,255,255,.82)", lineHeight: 1.45 }}>
                Open a card, read the instructions, do what the card says, then log the real
                result. If the field truth changed, write that down instead of forcing the card.
              </p>

              <div className="atlas-hero-stats" style={{ marginTop: 14 }}>
                <div className="atlas-hero-stat">
                  <span>Open</span>
                  <strong>{counts.open}</strong>
                </div>
                <div className="atlas-hero-stat">
                  <span>Due</span>
                  <strong>{counts.due}</strong>
                </div>
                <div className="atlas-hero-stat">
                  <span>Block</span>
                  <strong>{counts.blocked}</strong>
                </div>
              </div>
            </div>
          </section>

          {primaryTask ? (
            <section className="atlas-soft-card">
              <div className="atlas-soft-head">
                <div>
                  <span className="atlas-soft-label">Start here</span>
                  <h2 className="atlas-soft-heading">{primaryTask.title}</h2>
                </div>
                <span className="atlas-soft-badge">{prettyDate(primaryTask.due_date)}</span>
              </div>

              <p style={{ marginTop: 10 }}>{primaryTask.unlock_text}</p>

              <button
                type="button"
                className="atlas-zone-action accent"
                style={{ width: "100%", border: 0, marginTop: 12 }}
                onClick={() => openCard(primaryTask)}
              >
                Open this task
              </button>
            </section>
          ) : null}

          <section className="atlas-soft-card">
            <div className="atlas-soft-head">
              <div>
                <span className="atlas-soft-label">Task hand</span>
                <h2 className="atlas-soft-heading">Work cards</h2>
              </div>
              <span className="atlas-soft-badge">{visibleCards.length} shown</span>
            </div>

            <div className="atlas-add-form" style={{ marginTop: 12 }}>
              <label>
                <span className="atlas-soft-label">Show</span>
                <select value={filter} onChange={(event) => setFilter(event.target.value as TaskFilter)}>
                  <option value="open">Open tasks</option>
                  <option value="today">Due now</option>
                  <option value="blocked">Blocked</option>
                  <option value="done">Done</option>
                  <option value="all">Everything</option>
                </select>
              </label>

              <label>
                <span className="atlas-soft-label">Zone</span>
                <select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}>
                  <option value="all">All zones</option>
                  {zones.map((zone) => (
                    <option key={zone.key} value={zone.key}>
                      {zone.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {loading ? <div className="atlas-empty">Loading Atlas tasks...</div> : null}
            {error ? <div className="atlas-empty">{error}</div> : null}

            <div className="atlas-task-list" style={{ marginTop: 12 }}>
              {!loading && visibleCards.length === 0 ? (
                <div className="atlas-empty">No tasks match this view.</div>
              ) : null}

              {visibleCards.map((card) => (
                <article key={card.task_id} className="atlas-task-row atlas-task-row-playable">
                  <button
                    type="button"
                    className="atlas-task-row-main"
                    onClick={() => openCard(card)}
                  >
                    <div className="atlas-task-row-head">
                      <div>
                        <span className="atlas-soft-label">
                          {prettyDate(card.due_date)} · {card.zone_label ?? "Whole farm"}
                        </span>
                        <strong>{card.title}</strong>
                        <small>{card.unlock_text ?? card.note ?? "Open card for details."}</small>
                      </div>

                      <span className="atlas-primary-status">{statusLabel(card.status)}</span>
                    </div>

                    <div className="atlas-cue-row compact">
                      <span className="atlas-cue">{card.task_type.replaceAll("_", " ")}</span>
                      {card.objects.slice(0, 3).map((object) => (
                        <span className="atlas-cue" key={object.object_id}>
                          {object.object_label}
                        </span>
                      ))}
                    </div>
                  </button>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>

      {selectedCard ? (
        <section className="atlas-task-focus-overlay" role="dialog" aria-modal="true">
          <div className="atlas-task-focus-phone">
            <div className="atlas-task-focus-topbar">
              <div>
                <span className="atlas-phone-kicker">Task card</span>
                <strong>{selectedCard.zone_label ?? "Atlas"}</strong>
              </div>

              <button type="button" onClick={() => setSelectedCard(null)}>
                Close
              </button>
            </div>

            <div className="atlas-task-focus-body">
              <section className="atlas-task-focus-purple">
                <div className="atlas-task-focus-kicker">
                  <span>{statusLabel(selectedCard.status)}</span>
                  <span>{selectedCard.priority}</span>
                  <span>{prettyDate(selectedCard.due_date)}</span>
                </div>

                <h2>{selectedCard.title}</h2>

                {selectedCard.unlock_text ? <p>{selectedCard.unlock_text}</p> : null}
              </section>

              {selectedCard.objects.length > 0 ? (
                <section className="atlas-task-focus-section">
                  <span className="atlas-soft-label">Where</span>
                  <div className="atlas-zone-mini-stats">
                    {selectedCard.objects.map((object) => (
                      <span key={object.object_id}>{object.object_label}</span>
                    ))}
                  </div>
                </section>
              ) : null}

              {selectedCard.note ? (
                <section className="atlas-task-focus-section">
                  <span className="atlas-soft-label">Instructions / data</span>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {noteLines(selectedCard.note).map((line) => (
                      <p key={line} style={{ margin: 0 }}>
                        {line}
                      </p>
                    ))}
                  </div>
                </section>
              ) : null}

              {selectedCard.resource_requirements.length > 0 ? (
                <section className="atlas-task-focus-section">
                  <span className="atlas-soft-label">Bring / check</span>
                  <div className="atlas-zone-mini-stats">
                    {selectedCard.resource_requirements.map((requirement) => (
                      <span key={requirement.requirement_id}>
                        {requirement.resource_label ?? requirement.note ?? "Resource"}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="atlas-task-focus-section">
                <span className="atlas-soft-label">Log what actually happened</span>

                <label style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  <span className="atlas-soft-label">Who did it?</span>
                  <input
                    value={createdBy}
                    onChange={(event) => setCreatedBy(event.target.value)}
                    placeholder="anna"
                  />
                </label>

                <label style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  <span className="atlas-soft-label">Result note</span>
                  <textarea
                    value={resultNote}
                    onChange={(event) => setResultNote(event.target.value)}
                    placeholder="Example: I planted, but only BW9 because I ran out of seed. BW10 still needs finished."
                    rows={4}
                  />
                </label>

                <div className="atlas-task-play-actions" style={{ marginTop: 12 }}>
                  {(["done", "partial", "changed", "blocked", "needs_supplies"] as AtlasTaskResult[]).map(
                    (result) => (
                      <button
                        key={result}
                        type="button"
                        onClick={() => void handleTaskResult(result)}
                        disabled={savingResult !== null}
                        title={resultButtonLabel(result)}
                      >
                        {savingResult === result ? "Saving..." : resultButtonLabel(result)}
                      </button>
                    ),
                  )}
                </div>

                {resultMessage ? (
                  <p className="atlas-task-result-message">{resultMessage}</p>
                ) : null}
              </section>

              {selectedCard.task_logs.length > 0 ? (
                <section className="atlas-task-focus-section">
                  <span className="atlas-soft-label">Progress log</span>

                  <div className="atlas-field-log-list">
                    {selectedCard.task_logs.slice(0, 6).map((log) => (
                      <article key={log.field_log_id} className="atlas-field-log-item">
                        <div className="atlas-field-log-main">
                          <strong>{prettyDate(log.log_date)}</strong>
                          <span>{log.summary_sentence}</span>
                          {log.note ? <small>{log.note}</small> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
