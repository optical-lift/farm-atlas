"use client";

import { useEffect } from "react";

type Outcome = "done" | "partial" | "blocked";

const outcomes: Array<{ key: Outcome; label: string }> = [
  { key: "done", label: "Done" },
  { key: "partial", label: "Partial" },
  { key: "blocked", label: "Blocked" },
];

function titleFromCard(card: Element) {
  return card.querySelector("strong")?.textContent?.trim() ?? "";
}

async function postOutcome(taskTitle: string, outcome: Outcome, note: string) {
  const response = await fetch("/api/atlas/task-outcome", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskTitle, outcome, note, reason: note }),
  });
  const data = (await response.json()) as { ok?: boolean; error?: string; details?: string };
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Task update failed.");
}

function addActions(card: Element) {
  if (card.getAttribute("data-outcome-ready") === "true") return;
  const taskTitle = titleFromCard(card);
  if (!taskTitle) return;
  card.setAttribute("data-outcome-ready", "true");

  const wrap = document.createElement("div");
  wrap.className = "atlas-outcome-actions";

  outcomes.forEach(({ key, label }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = `atlas-outcome-button ${key}`;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const note = key === "done" ? "" : window.prompt(key === "partial" ? "What is left?" : "What stopped it?", "") ?? "";
      button.disabled = true;
      button.textContent = "Saving";
      try {
        await postOutcome(taskTitle, key, note);
        button.textContent = key === "done" ? "Done" : "Saved";
        wrap.setAttribute("data-outcome", key);
      } catch (error) {
        button.disabled = false;
        button.textContent = label;
        window.alert(error instanceof Error ? error.message : "Task update failed.");
      }
    });
    wrap.appendChild(button);
  });

  card.insertAdjacentElement("afterend", wrap);
}

function run() {
  document.querySelectorAll(".atlas-project-task-card").forEach(addActions);
}

export default function AtlasOutcomeBridge() {
  useEffect(() => {
    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
