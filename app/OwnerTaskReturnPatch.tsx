"use client";

import { useEffect } from "react";

export default function OwnerTaskReturnPatch() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof window.fetch>) => {
      const response = await originalFetch(...args);

      try {
        const [input, init] = args;
        const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const params = new URLSearchParams(window.location.search);
        const isOwnerTask = window.location.pathname === "/task" && params.get("scope") === "owner";
        const closesOrMovesTask = requestUrl.includes("/api/atlas/task-transition") || requestUrl.includes("/api/atlas/task-outcome") || requestUrl.includes("/api/atlas/task-reschedule");

        if (isOwnerTask && method === "POST" && closesOrMovesTask && response.ok) {
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
