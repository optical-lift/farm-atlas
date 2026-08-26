"use client";

import { type MouseEvent, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallbackPath: string;
  showCloseControl?: boolean;
};

function safeLocalReturnPath(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//") ? trimmed : null;
}

function sameOriginHistoryAvailable() {
  if (window.history.length <= 1 || !document.referrer) return false;
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function leaveTaskFocus(fallbackPath: string) {
  const requested = safeLocalReturnPath(new URLSearchParams(window.location.search).get("returnTo"));
  if (requested) {
    window.location.assign(requested);
    return;
  }
  if (sameOriginHistoryAvailable()) {
    window.history.back();
    return;
  }
  window.location.assign(fallbackPath);
}

export default function TaskFocusNavigationBoundary({ children, fallbackPath, showCloseControl = false }: Props) {
  function handleNavigationCapture(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest(".atlas-note-plus");
    if (!control || !event.currentTarget.contains(control)) return;
    event.preventDefault();
    event.stopPropagation();
    leaveTaskFocus(fallbackPath);
  }

  return (
    <div
      className="atlas-task-focus-navigation-boundary"
      data-atlas-task-focus-navigation="v1"
      onClickCapture={handleNavigationCapture}
    >
      <style>{`
        .atlas-task-focus-navigation-boundary .atlas-note-plus {
          font-size: 0 !important;
          text-decoration: none !important;
        }
        .atlas-task-focus-navigation-boundary .atlas-note-plus::before {
          content: "×";
          font-size: 1.45rem;
          font-weight: 500;
          line-height: 1;
        }
        .atlas-task-focus-close {
          position: fixed;
          z-index: 80;
          top: calc(env(safe-area-inset-top, 0px) + 14px);
          right: max(14px, calc((100vw - 520px) / 2 + 18px));
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: var(--atlas-accent-soft, #e8ecb8);
          color: var(--atlas-text, #343542);
          box-shadow: 0 4px 14px rgba(52, 53, 66, 0.12);
          font: inherit;
          font-size: 1.6rem;
          font-weight: 500;
          line-height: 1;
          cursor: pointer;
        }
        .atlas-task-focus-close:focus-visible {
          outline: 2px solid currentColor;
          outline-offset: 3px;
        }
      `}</style>
      {showCloseControl ? (
        <button
          type="button"
          className="atlas-task-focus-close"
          aria-label="Close task"
          onClick={() => leaveTaskFocus(fallbackPath)}
        >
          ×
        </button>
      ) : null}
      {children}
    </div>
  );
}
