"use client";

import { useEffect, useRef, useState } from "react";

type NotebookMarkState = {
  circle: boolean;
  underline: boolean;
  bracket: boolean;
  starred: boolean;
  highlight: string | null;
  note: string;
};

const EMPTY_MARKS: NotebookMarkState = {
  circle: false,
  underline: false,
  bracket: false,
  starred: false,
  highlight: null,
  note: "",
};

const HIGHLIGHTS = [
  { label: "Clay", value: "#d6b7a7" },
  { label: "Sage", value: "#bcc7b5" },
  { label: "Ochre", value: "#d9c88f" },
  { label: "Blue gray", value: "#b8c5cc" },
];

function storageKey(targetKey: string) {
  return `atlas:notebook-mark:v1:${targetKey}`;
}

export default function NotebookMarkedText({
  targetKey,
  children,
}: {
  targetKey: string;
  children: string;
}) {
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<NotebookMarkState>(EMPTY_MARKS);
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(targetKey));
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<NotebookMarkState>;
      const next = { ...EMPTY_MARKS, ...parsed };
      setMarks(next);
      setNoteDraft(next.note);
    } catch {
      // Prototype annotation persistence is best-effort and never blocks the task page.
    }
  }, [targetKey]);

  function persist(next: NotebookMarkState) {
    setMarks(next);
    try {
      window.localStorage.setItem(storageKey(targetKey), JSON.stringify(next));
    } catch {
      // The visual mark may remain in-memory if local storage is unavailable.
    }
  }

  function toggle(key: "circle" | "underline" | "bracket" | "starred") {
    persist({ ...marks, [key]: !marks[key] });
  }

  function setHighlight(value: string) {
    persist({ ...marks, highlight: marks.highlight === value ? null : value });
    setOpen(false);
  }

  function clearMarks() {
    persist(EMPTY_MARKS);
    setNoteDraft("");
    setNoteEditing(false);
    setOpen(false);
  }

  function saveNote() {
    const note = noteDraft.trim();
    persist({ ...marks, note });
    setNoteDraft(note);
    setNoteEditing(false);
    setOpen(false);
  }

  function beginLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      setOpen(true);
      longPressTimer.current = null;
    }, 460);
  }

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onPointerDown={beginLongPress}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
        aria-expanded={open}
        aria-label={`Annotate ${children}`}
        style={{
          appearance: "none",
          border: 0,
          background: "transparent",
          color: "inherit",
          padding: "1px 4px 2px 2px",
          margin: 0,
          font: "inherit",
          lineHeight: "inherit",
          textAlign: "left",
          cursor: "pointer",
          position: "relative",
          zIndex: 1,
          maxWidth: "100%",
          overflowWrap: "anywhere",
        }}
      >
        {marks.highlight ? (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: -1,
              right: -3,
              top: "48%",
              bottom: 1,
              background: marks.highlight,
              opacity: 0.48,
              transform: "rotate(-0.25deg)",
              borderRadius: "42% 54% 47% 55%",
              zIndex: -1,
            }}
          />
        ) : null}

        {marks.circle ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 100 38"
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              left: -5,
              right: -7,
              top: -5,
              width: "calc(100% + 12px)",
              height: "calc(100% + 10px)",
              overflow: "visible",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <path
              d="M4 19 C4 6 19 2 49 2 C78 1 96 6 97 18 C98 30 80 36 50 36 C21 36 3 31 4 19 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M5 18 C6 7 21 3 50 3 C80 3 95 7 96 19 C96 30 79 34 49 35"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.55"
              opacity="0.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}

        {marks.underline ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 100 8"
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              left: 0,
              bottom: -4,
              width: "100%",
              height: 8,
              pointerEvents: "none",
            }}
          >
            <path
              d="M1 4 C17 3.2 30 4.6 48 3.8 C66 3 80 4.9 99 3.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}

        {marks.bracket ? (
          <svg
            aria-hidden="true"
            viewBox="0 0 12 40"
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              left: -10,
              top: -4,
              width: 9,
              height: "calc(100% + 8px)",
              pointerEvents: "none",
            }}
          >
            <path
              d="M10 2 C5 2 4 4 4 9 L4 31 C4 36 6 38 10 38"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.15"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}

        <span>{children}</span>
        {marks.starred ? (
          <span aria-hidden="true" style={{ marginLeft: 7, fontSize: "0.9em" }}>
            ☆
          </span>
        ) : null}
      </button>

      {marks.note && !noteEditing ? (
        <span
          style={{
            display: "block",
            margin: "4px 0 0 3px",
            color: "#555",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontStyle: "italic",
            fontSize: 13,
            lineHeight: 1.35,
            transform: "rotate(-0.2deg)",
          }}
        >
          {marks.note}
        </span>
      ) : null}

      {noteEditing ? (
        <span
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 6,
            minWidth: "min(360px, calc(100vw - 90px))",
          }}
        >
          <input
            autoFocus
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveNote();
              }
              if (event.key === "Escape") {
                setNoteDraft(marks.note);
                setNoteEditing(false);
              }
            }}
            placeholder="margin note"
            aria-label={`Notebook note for ${children}`}
            style={{
              width: "100%",
              minWidth: 0,
              border: 0,
              borderBottom: "1px solid #777",
              borderRadius: 0,
              background: "transparent",
              color: "inherit",
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontStyle: "italic",
              fontSize: 15,
              padding: "4px 2px",
              outlineOffset: 2,
            }}
          />
          <button type="button" onClick={saveNote} style={smallTextButtonStyle}>
            keep
          </button>
        </span>
      ) : null}

      {open ? (
        <span
          role="menu"
          aria-label="Notebook marks"
          style={{
            position: "absolute",
            left: 0,
            top: "calc(100% + 8px)",
            zIndex: 20,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 5,
            width: "max-content",
            maxWidth: "min(430px, calc(100vw - 64px))",
            padding: "7px 8px",
            background: "rgba(255,255,255,0.98)",
            border: "1px solid #aaa",
            boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
          }}
        >
          <button type="button" role="menuitem" onClick={() => toggle("circle")} style={toolButtonStyle}>
            circle
          </button>
          <button type="button" role="menuitem" onClick={() => toggle("underline")} style={toolButtonStyle}>
            underline
          </button>
          <button type="button" role="menuitem" onClick={() => toggle("bracket")} style={toolButtonStyle}>
            bracket
          </button>
          <button type="button" role="menuitem" onClick={() => toggle("starred")} style={toolButtonStyle}>
            ☆
          </button>
          {HIGHLIGHTS.map((highlight) => (
            <button
              key={highlight.value}
              type="button"
              role="menuitem"
              aria-label={`${highlight.label} highlight`}
              title={`${highlight.label} highlight`}
              onClick={() => setHighlight(highlight.value)}
              style={{
                width: 29,
                height: 29,
                borderRadius: "50%",
                border: marks.highlight === highlight.value ? "1.5px solid #111" : "1px solid #aaa",
                background: highlight.value,
                cursor: "pointer",
              }}
            />
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setNoteDraft(marks.note);
              setNoteEditing(true);
              setOpen(false);
            }}
            style={toolButtonStyle}
          >
            note
          </button>
          <button type="button" role="menuitem" onClick={clearMarks} style={{ ...toolButtonStyle, color: "#666" }}>
            clear
          </button>
        </span>
      ) : null}
    </span>
  );
}

const toolButtonStyle = {
  appearance: "none",
  border: "1px solid #c5c5c5",
  borderRadius: 0,
  background: "#fff",
  color: "#111",
  font: "inherit",
  fontSize: 12,
  lineHeight: 1,
  padding: "7px 8px",
  cursor: "pointer",
} as const;

const smallTextButtonStyle = {
  appearance: "none",
  border: 0,
  background: "transparent",
  color: "#444",
  font: "inherit",
  fontSize: 12,
  padding: "5px 0",
  cursor: "pointer",
} as const;
