"use client";

import type { ReactNode } from "react";

type Props = {
  busy?: boolean;
  doneLabel?: string;
  doneBusyLabel?: string;
  doneBusy?: boolean;
  doneDisabled?: boolean;
  unfinishedOpen: boolean;
  onToggleUnfinished: () => void;
  onDone: () => void;
  children?: ReactNode;
};

export default function TaskPrimaryResultControls({
  busy = false,
  doneLabel = "Done",
  doneBusyLabel = "Finishing",
  doneBusy = false,
  doneDisabled = false,
  unfinishedOpen,
  onToggleUnfinished,
  onDone,
  children,
}: Props) {
  return (
    <>
      <style>{`
        [data-atlas-assigned-task-execution-shell="true"] .atlas-task-more-outcomes,
        [data-atlas-assigned-task-execution-shell="true"] .task-receipt-secondary {
          display: none !important;
        }

        .atlas-task-result-actions-simple {
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:8px;
          width:100%;
        }
        .atlas-task-result-actions-simple > button,
        .atlas-task-unfinished-panel button {
          min-height:48px;
          border:1px solid rgba(139,145,194,.25);
          border-radius:15px;
          background:rgba(255,255,255,.82);
          color:#676a7d;
          padding:9px 10px;
          font:inherit;
          font-size:11px;
          line-height:1.1;
          font-weight:900;
          -webkit-appearance:none;
          appearance:none;
        }
        .atlas-task-result-actions-simple > button.done {
          background:rgba(214,225,177,.72);
          color:#515b34;
        }
        .atlas-task-result-actions-simple > button.done.is-readiness-warning {
          background:rgba(238,233,184,.58);
          color:#69613d;
        }
        .atlas-task-result-actions-simple > button.unfinished.is-open {
          border-color:rgba(103,106,125,.34);
          background:rgba(247,246,250,.94);
        }
        .atlas-task-result-actions-simple > button:disabled,
        .atlas-task-unfinished-panel button:disabled { opacity:.5; }
        .atlas-task-unfinished-panel,
        .atlas-task-result-unfinished {
          display:grid;
          gap:10px;
          margin-top:10px;
          padding:12px;
          border:1px solid rgba(207,196,179,.72);
          border-radius:15px;
          background:rgba(250,248,239,.82);
        }
        .atlas-task-unfinished-panel > strong {
          color:#4e504d;
          font-size:12px;
        }
        .atlas-task-unfinished-grid {
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:7px;
        }
        @media (max-width:420px) {
          .atlas-task-result-actions-simple { gap:7px; }
        }
      `}</style>
      <div className="atlas-task-result-actions atlas-task-result-actions-simple">
        <button
          type="button"
          className={doneDisabled ? "done is-readiness-warning" : "done"}
          disabled={busy}
          data-atlas-readiness-guard={doneDisabled ? "soft" : "clear"}
          onClick={onDone}
        >
          {doneBusy ? doneBusyLabel : doneLabel}
        </button>
        <button
          type="button"
          className={unfinishedOpen ? "unfinished is-open" : "unfinished"}
          aria-expanded={unfinishedOpen}
          disabled={busy}
          onClick={onToggleUnfinished}
        >
          Unfinished
        </button>
      </div>
      {unfinishedOpen ? children : null}
    </>
  );
}
