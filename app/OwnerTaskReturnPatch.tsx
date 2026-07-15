"use client";

import { useEffect, useLayoutEffect } from "react";

function isOwnerTaskRoute() {
  if (window.location.pathname !== "/task") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("returnTo") === "/owner" || params.get("scope") === "owner";
}

export default function OwnerTaskReturnPatch() {
  useLayoutEffect(() => {
    if (!isOwnerTaskRoute()) return;

    const style = document.createElement("style");
    style.dataset.ownerTaskLoadingGuard = "true";
    style.textContent = `
      body.atlas-owner-task-loading .atlas-task-page-body > * { display: none !important; }
      body.atlas-owner-task-loading .atlas-task-page-body::before {
        content: "Loading task…";
        display: block;
        margin: 12px;
        border: 1px solid var(--atlas-border);
        border-radius: 18px;
        background: rgba(255,255,255,.86);
        color: var(--atlas-muted);
        padding: 14px;
        font-size: 14px;
        font-weight: 850;
      }
    `;
    document.head.appendChild(style);
    document.body.classList.add("atlas-owner-task-loading");

    const revealWhenReady = () => {
      if (!document.querySelector(".atlas-task-ticket-card")) return;
      document.body.classList.remove("atlas-owner-task-loading");
      style.remove();
      observer.disconnect();
    };

    const observer = new MutationObserver(revealWhenReady);
    observer.observe(document.body, { childList: true, subtree: true });
    revealWhenReady();

    return () => {
      observer.disconnect();
      document.body.classList.remove("atlas-owner-task-loading");
      style.remove();
    };
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof window.fetch>) => {
      const response = await originalFetch(...args);

      try {
        const [input, init] = args;
        const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const closesOrMovesTask = requestUrl.includes("/api/atlas/task-transition") || requestUrl.includes("/api/atlas/task-outcome") || requestUrl.includes("/api/atlas/task-reschedule");

        if (isOwnerTaskRoute() && method === "POST" && closesOrMovesTask && response.ok) {
          window.setTimeout(() => window.location.assign("/owner"), 120);
        }
      } catch {
        // Leave the normal task flow untouched if redirect detection fails.
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
