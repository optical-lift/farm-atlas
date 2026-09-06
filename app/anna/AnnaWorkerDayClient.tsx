"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import NotebookMarkedText from "@/app/anna/NotebookMarkedText";

type WorkerDayItem = {
  id: string;
  key: string;
  title: string;
  details: string[];
  completed: boolean;
  institutionallyCompleted: boolean;
  reportedCompleted: boolean;
  active: boolean;
};

type WorkerDayExtra = {
  id: string;
  key: string;
  title: string;
};

type ConflictState = {
  targetProjectionId: string;
  activeTitle: string;
  choosingStopTime: boolean;
};

type PilotResponse = {
  ok?: boolean;
  code?: string;
  status?: string;
  activeProjectionId?: string;
  activeTitle?: string;
};

const taskTextStyle = {
  fontSize: 16,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
} as const;

const detailTextStyle = {
  fontSize: 13,
  lineHeight: 1.45,
  color: "#4a4a4a",
  overflowWrap: "anywhere",
} as const;

function currentTimeValue() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function todayAtTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const when = new Date();
  when.setHours(hours, minutes, 0, 0);
  return when.toISOString();
}

export default function AnnaWorkerDayClient({
  items,
  extras,
  canEdit,
}: {
  items: WorkerDayItem[];
  extras: WorkerDayExtra[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [stopTime, setStopTime] = useState(currentTimeValue);
  const [extraOpen, setExtraOpen] = useState(false);
  const [extraTitle, setExtraTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notebookMode, setNotebookMode] = useState(false);

  const allVisible = useMemo(() => items.length + extras.length, [items, extras]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNotebookMode(params.get("notebook") === "1");
  }, []);

  async function requestPilot(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/anna/pilot", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as PilotResponse;
      if (response.status === 409 && result.code === "attention_conflict") {
        return result;
      }

      if (!response.ok || result.ok !== true) {
        throw new Error(result.code ?? "pilot_request_failed");
      }

      return result;
    } finally {
      setBusy(false);
    }
  }

  async function finishMutation(payload: Record<string, unknown>) {
    try {
      const result = await requestPilot(payload);
      if (result?.code === "attention_conflict") {
        setConflict({
          targetProjectionId: String(payload.projectionId),
          activeTitle: result.activeTitle ?? "Previous task",
          choosingStopTime: false,
        });
        setStopTime(currentTimeValue());
        return;
      }

      setConflict(null);
      router.refresh();
    } catch (requestError) {
      console.error(requestError);
      setError("That change did not save. Try again.");
    }
  }

  async function handleCompletion(item: WorkerDayItem) {
    if (!canEdit || busy || item.institutionallyCompleted) return;

    await finishMutation({
      action: item.reportedCompleted ? "reopen" : "done",
      projectionId: item.id,
      effectiveAt: new Date().toISOString(),
    });
  }

  async function handleAttention(item: WorkerDayItem) {
    if (!canEdit || busy || item.completed) return;

    await finishMutation({
      action: item.active ? "stop" : "start",
      projectionId: item.id,
      effectiveAt: new Date().toISOString(),
    });
  }

  async function resolveConflict(action: "switch_finish" | "switch_stop", effectiveAt?: string) {
    if (!conflict) return;

    await finishMutation({
      action,
      projectionId: conflict.targetProjectionId,
      effectiveAt: effectiveAt ?? new Date().toISOString(),
    });
  }

  async function addExtra() {
    const title = extraTitle.trim();
    if (!title || busy) return;

    try {
      await requestPilot({
        action: "report_unscheduled",
        reportedTitle: title,
        effectiveAt: new Date().toISOString(),
      });
      setExtraTitle("");
      setExtraOpen(false);
      router.refresh();
    } catch (requestError) {
      console.error(requestError);
      setError("That did not save. Try again.");
    }
  }

  return (
    <>
      <div
        style={
          notebookMode
            ? {
                position: "relative",
                padding: "4px 10px 16px 11px",
                margin: "0 -11px",
                backgroundImage: "radial-gradient(#d7d7d2 0.65px, transparent 0.65px)",
                backgroundSize: "16px 16px",
              }
            : undefined
        }
      >
        {notebookMode ? (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "baseline",
              marginBottom: 12,
              paddingBottom: 6,
              borderBottom: "1px solid #2b2b2b",
              fontSize: 11,
              color: "#666",
              letterSpacing: "0.04em",
            }}
          >
            <span>notebook interaction study</span>
            <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic" }}>
              tap the words
            </span>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: notebookMode ? 10 : 12 }}>
          {items.map((item) => (
            <div
              key={item.key}
              data-anna-task-key={item.key}
              data-worker-projection-id={item.id}
              style={
                notebookMode
                  ? {
                      paddingBottom: 3,
                      borderBottom: "1px solid rgba(20,20,20,0.10)",
                    }
                  : undefined
              }
            >
              <div
                style={{
                  ...taskTextStyle,
                  display: "grid",
                  gridTemplateColumns: "22px minmax(0, 1fr) 28px",
                  columnGap: 7,
                  alignItems: "start",
                }}
              >
                {canEdit && !item.institutionallyCompleted ? (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={item.completed ? `Reopen ${item.title}` : `Mark ${item.title} done`}
                    onClick={() => void handleCompletion(item)}
                    style={{
                      appearance: "none",
                      border: 0,
                      background: "transparent",
                      padding: 0,
                      margin: 0,
                      color: "inherit",
                      font: "inherit",
                      lineHeight: 1.45,
                      cursor: busy ? "default" : "pointer",
                      textAlign: "left",
                      width: 22,
                      height: 24,
                      display: "grid",
                      placeItems: "start",
                    }}
                  >
                    {notebookMode ? (
                      <span
                        aria-hidden="true"
                        style={{
                          display: "block",
                          width: 14,
                          height: 14,
                          marginTop: 4,
                          marginLeft: 1,
                          boxSizing: "border-box",
                          border: "1.4px solid #111",
                          borderRadius: "48% 52% 47% 53%",
                          background: item.completed ? "#111" : "transparent",
                          transform: "rotate(-1deg)",
                        }}
                      />
                    ) : item.completed ? (
                      "●"
                    ) : (
                      "○"
                    )}
                  </button>
                ) : (
                  <span aria-hidden="true" style={{ lineHeight: 1.45 }}>
                    {notebookMode ? (
                      <span
                        style={{
                          display: "block",
                          width: 14,
                          height: 14,
                          marginTop: 4,
                          marginLeft: 1,
                          boxSizing: "border-box",
                          border: "1.4px solid #111",
                          borderRadius: "48% 52% 47% 53%",
                          background: item.completed ? "#111" : "transparent",
                          transform: "rotate(-1deg)",
                        }}
                      />
                    ) : item.completed ? (
                      "●"
                    ) : (
                      "○"
                    )}
                  </span>
                )}

                {notebookMode ? (
                  <NotebookMarkedText targetKey={`task:${item.id}`}>{item.title}</NotebookMarkedText>
                ) : (
                  <span>{item.title}</span>
                )}

                {canEdit && !item.completed ? (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={item.active ? `Stop working on ${item.title}` : `Work on ${item.title}`}
                    onClick={() => void handleAttention(item)}
                    style={{
                      appearance: "none",
                      border: 0,
                      background: "transparent",
                      padding: "1px 0 0",
                      margin: 0,
                      width: 28,
                      height: 24,
                      cursor: busy ? "default" : "pointer",
                      display: "flex",
                      justifyContent: "flex-end",
                      alignItems: "flex-start",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        display: "block",
                        height: 19,
                        borderLeft: item.active ? "2px solid #111" : "1px solid #a6a6a6",
                        transform: notebookMode ? "rotate(0.7deg)" : undefined,
                      }}
                    />
                  </button>
                ) : (
                  <span
                    aria-hidden="true"
                    style={{
                      justifySelf: "end",
                      marginTop: 1,
                      height: 19,
                      borderLeft: item.active ? "2px solid #111" : "1px solid #d2d2d2",
                      transform: notebookMode ? "rotate(0.7deg)" : undefined,
                    }}
                  />
                )}
              </div>

              {item.details.length > 0 ? (
                <ul
                  style={{
                    ...detailTextStyle,
                    margin: "5px 35px 0 29px",
                    paddingLeft: 20,
                    fontFamily: notebookMode ? "Georgia, 'Times New Roman', serif" : undefined,
                    fontStyle: notebookMode ? "italic" : undefined,
                  }}
                >
                  {item.details.map((detail, index) => (
                    <li key={`${item.key}-detail-${index}`}>{detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}

          {extras.map((extra) => (
            <div
              key={extra.key}
              style={{
                ...taskTextStyle,
                display: "grid",
                gridTemplateColumns: "22px minmax(0, 1fr) 28px",
                columnGap: 7,
                alignItems: "start",
                ...(notebookMode
                  ? {
                      paddingBottom: 3,
                      borderBottom: "1px solid rgba(20,20,20,0.10)",
                    }
                  : {}),
              }}
            >
              <span aria-hidden="true">
                {notebookMode ? (
                  <span
                    style={{
                      display: "block",
                      width: 14,
                      height: 14,
                      marginTop: 4,
                      marginLeft: 1,
                      borderRadius: "48% 52% 47% 53%",
                      background: "#111",
                      transform: "rotate(-1deg)",
                    }}
                  />
                ) : (
                  "●"
                )}
              </span>
              {notebookMode ? (
                <NotebookMarkedText targetKey={`extra:${extra.id}`}>{extra.title}</NotebookMarkedText>
              ) : (
                <span>{extra.title}</span>
              )}
              <span aria-hidden="true" />
            </div>
          ))}
        </div>

        {notebookMode ? (
          <div
            style={{
              marginTop: 18,
              paddingTop: 8,
              borderTop: "1px solid #333",
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 11,
              lineHeight: 1.4,
              color: "#686868",
            }}
          >
            <span>○ changes work reality</span>
            <span>circle · underline · bracket · color · ☆ are only your notebook marks</span>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <div style={{ marginTop: allVisible > 0 ? 24 : 0 }}>
          {extraOpen ? (
            <div style={{ display: "grid", gap: 8 }}>
              <input
                autoFocus
                value={extraTitle}
                onChange={(event) => setExtraTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addExtra();
                  }
                }}
                placeholder="What did you do?"
                aria-label="Something I did"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "1px solid #c9c9c9",
                  borderRadius: 0,
                  background: "#fff",
                  color: "#111",
                  font: "inherit",
                  fontSize: 16,
                  padding: "8px 9px",
                }}
              />
              <div style={{ display: "flex", gap: 14, fontSize: 14 }}>
                <button
                  type="button"
                  disabled={busy || !extraTitle.trim()}
                  onClick={() => void addExtra()}
                  style={textButtonStyle}
                >
                  Add
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setExtraOpen(false);
                    setExtraTitle("");
                  }}
                  style={textButtonStyle}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setExtraOpen(true)}
              style={{
                ...textButtonStyle,
                fontSize: 14,
                color: "#555",
              }}
            >
              + Add something I did
            </button>
          )}
        </div>
      ) : null}

      {error ? (
        <div role="status" style={{ marginTop: 16, fontSize: 13, color: "#555" }}>
          {error}
        </div>
      ) : null}

      {conflict ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Previous work is still active"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "grid",
            placeItems: "center",
            padding: 20,
            background: "rgba(255,255,255,0.72)",
          }}
        >
          <div
            style={{
              width: "min(360px, 100%)",
              boxSizing: "border-box",
              border: "1px solid #bdbdbd",
              background: "#fff",
              padding: 18,
            }}
          >
            {!conflict.choosingStopTime ? (
              <>
                <div style={{ fontSize: 15, lineHeight: 1.45, marginBottom: 16 }}>
                  <strong>{conflict.activeTitle}</strong> is still being worked on.
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolveConflict("switch_finish")}
                    style={choiceButtonStyle}
                  >
                    I finished it
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setConflict((current) =>
                        current ? { ...current, choosingStopTime: true } : current,
                      )
                    }
                    style={choiceButtonStyle}
                  >
                    I stopped working on it
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConflict(null)}
                    style={choiceButtonStyle}
                  >
                    Never mind — I’m still working on it
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, lineHeight: 1.45, marginBottom: 14 }}>
                  When?
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolveConflict("switch_stop")}
                    style={choiceButtonStyle}
                  >
                    Now
                  </button>
                  <input
                    type="time"
                    value={stopTime}
                    onChange={(event) => setStopTime(event.target.value)}
                    aria-label="Time I stopped"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      border: "1px solid #c9c9c9",
                      borderRadius: 0,
                      background: "#fff",
                      color: "#111",
                      font: "inherit",
                      fontSize: 16,
                      padding: "8px 9px",
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy || !stopTime}
                    onClick={() =>
                      void resolveConflict("switch_stop", todayAtTime(stopTime))
                    }
                    style={choiceButtonStyle}
                  >
                    Use this time
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setConflict((current) =>
                        current ? { ...current, choosingStopTime: false } : current,
                      )
                    }
                    style={choiceButtonStyle}
                  >
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

const textButtonStyle = {
  appearance: "none",
  border: 0,
  background: "transparent",
  padding: 0,
  margin: 0,
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
  textAlign: "left",
} as const;

const choiceButtonStyle = {
  ...textButtonStyle,
  width: "100%",
  fontSize: 15,
  lineHeight: 1.4,
  padding: "5px 0",
} as const;
