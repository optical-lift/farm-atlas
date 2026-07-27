"use client";

import { useEffect } from "react";

export default function TaskResultAnchorPatch() {
  useEffect(() => {
    if (window.location.hash !== "#result") return;

    const timer = window.setTimeout(() => {
      const result = document.querySelector<HTMLElement>(".atlas-task-result-footer");
      if (!result) return;
      result.id = "result";
      result.scrollIntoView({ block: "start", behavior: "smooth" });

      const params = new URLSearchParams(window.location.search);
      if (params.get("correction") === "1" && !result.previousElementSibling?.classList.contains("atlas-task-correction-note")) {
        const note = document.createElement("p");
        note.className = "atlas-task-correction-note";
        note.textContent = "This completion has linked farm evidence. Review the recorded result before correcting it.";
        result.before(note);
      }
    }, 80);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
