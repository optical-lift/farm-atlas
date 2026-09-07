"use client";

import { useEffect, useState } from "react";

export default function ElmWorkPassPage() {
  const [pass, setPass] = useState("");
  const [status, setStatus] = useState<"idle" | "opening" | "error">("idle");

  useEffect(() => {
    const fragment = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(fragment);
    const fragmentPass = params.get("pass")?.trim() ?? "";

    if (fragmentPass) {
      setPass(fragmentPass);
      window.history.replaceState(null, "", "/work");
    }
  }, []);

  async function openWork() {
    if (!pass || status === "opening") return;

    setStatus("opening");

    const response = await fetch("/api/work-pass/redeem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pass }),
      credentials: "same-origin",
    });

    const result = (await response.json().catch(() => null)) as
      | { ok?: boolean; destination?: string }
      | null;

    if (!response.ok || result?.ok !== true || !result.destination) {
      setStatus("error");
      return;
    }

    window.location.replace(result.destination);
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#fff",
        color: "#111",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <section style={{ width: "min(420px, 100%)" }}>
        <p style={{ margin: "0 0 10px", fontSize: 14, color: "#666" }}>Elm</p>
        <h1 style={{ margin: "0 0 12px", fontSize: 28, lineHeight: 1.15 }}>
          Work Pass
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: 16, lineHeight: 1.5 }}>
          Open the work Elm has made available to you.
        </p>

        <button
          type="button"
          onClick={() => void openWork()}
          disabled={!pass || status === "opening"}
          style={{
            width: "100%",
            minHeight: 48,
            borderRadius: 999,
            border: "1px solid #111",
            background: status === "opening" ? "#f3f3f3" : "#111",
            color: status === "opening" ? "#444" : "#fff",
            fontSize: 16,
            fontWeight: 600,
            cursor: !pass || status === "opening" ? "default" : "pointer",
          }}
        >
          {status === "opening" ? "Opening…" : "Open work"}
        </button>

        {status === "error" ? (
          <p style={{ margin: "16px 0 0", fontSize: 14, lineHeight: 1.45, color: "#8a1c1c" }}>
            This Work Pass is no longer available. Ask Elm for a new one.
          </p>
        ) : null}

        {!pass ? (
          <p style={{ margin: "16px 0 0", fontSize: 14, lineHeight: 1.45, color: "#666" }}>
            This page needs an Elm Work Pass link.
          </p>
        ) : null}
      </section>
    </main>
  );
}
