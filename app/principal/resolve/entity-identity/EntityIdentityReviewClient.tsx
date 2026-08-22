"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  EntityIdentityReviewItem,
  EntityIdentityReviewPacket,
} from "@/lib/atlas/entity-identity-review";

type Decision = "approved" | "rejected";

type Props = {
  packet: EntityIdentityReviewPacket;
};

const cardStyle = {
  border: "1px solid rgba(38,38,38,.12)",
  borderRadius: 18,
  background: "rgba(255,255,255,.82)",
  padding: 18,
  boxShadow: "0 10px 32px rgba(47,43,31,.045)",
} as const;

const labelStyle = {
  display: "block",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: ".12em",
  textTransform: "uppercase" as const,
  opacity: .58,
};

function formatDate(value: string | null) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString();
}

function Evidence({ item }: { item: EntityIdentityReviewItem }) {
  const evidence = item.evidence && typeof item.evidence === "object" ? item.evidence : {};
  const entries = Object.entries(evidence).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {entries.length ? entries.map(([key, value]) => (
        <div key={key} style={{ display: "grid", gridTemplateColumns: "minmax(150px,.7fr) minmax(0,1.3fr)", gap: 10, alignItems: "baseline" }}>
          <span style={{ fontSize: 12, fontWeight: 800, opacity: .62 }}>{key.replaceAll("_", " ")}</span>
          <span style={{ fontSize: 13, overflowWrap: "anywhere" }}>
            {typeof value === "string" ? value : JSON.stringify(value)}
          </span>
        </div>
      )) : <span style={{ opacity: .62 }}>No evidence packet was attached.</span>}
    </div>
  );
}

export default function EntityIdentityReviewClient({ packet }: Props) {
  const router = useRouter();
  const [basisById, setBasisById] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function adjudicate(item: EntityIdentityReviewItem, decision: Decision) {
    const basis = basisById[item.review_id]?.trim() ?? "";
    if (!basis) {
      setErrorById((current) => ({ ...current, [item.review_id]: "Write the reason for the decision before submitting it." }));
      return;
    }
    if (item.review_kind === "entity_merge" && decision === "approved" && !item.approval_ready) {
      setErrorById((current) => ({ ...current, [item.review_id]: "Approval is blocked until every required hard-veto rule is known and passing." }));
      return;
    }

    const key = `${item.review_id}:${decision}`;
    setBusyKey(key);
    setErrorById((current) => ({ ...current, [item.review_id]: "" }));

    try {
      const response = await fetch("/api/atlas/entity-identity-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-atlas-intent": "entity-identity-review-v1",
        },
        body: JSON.stringify({
          reviewKind: item.review_kind,
          reviewId: item.review_id,
          decision,
          basis,
          metadata: { surface: "principal_entity_identity_review_v1" },
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message || "Atlas could not record this decision.");

      setBasisById((current) => ({ ...current, [item.review_id]: "" }));
      router.refresh();
    } catch (error) {
      setErrorById((current) => ({
        ...current,
        [item.review_id]: error instanceof Error ? error.message : "Atlas could not record this decision.",
      }));
    } finally {
      setBusyKey(null);
    }
  }

  if (!packet.items.length) {
    return (
      <section style={cardStyle}>
        <span style={labelStyle}>Identity review</span>
        <h2 style={{ margin: "7px 0 0", fontSize: 26 }}>No identity decision needs review</h2>
        <p style={{ margin: "8px 0 0", lineHeight: 1.55, opacity: .72 }}>
          Resolver recommendations remain contained until one earns this queue. No canonical merge can be executed from this workspace.
        </p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {packet.items.map((item) => {
        const approveBusy = busyKey === `${item.review_id}:approved`;
        const rejectBusy = busyKey === `${item.review_id}:rejected`;
        const merge = item.review_kind === "entity_merge";
        const error = errorById[item.review_id];

        return (
          <section key={`${item.review_kind}:${item.review_id}`} style={cardStyle}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
              <span style={labelStyle}>{merge ? "Canonical entity merge recommendation" : "Ingestion identity recommendation"}</span>
              <span style={{ fontSize: 12, fontWeight: 800, opacity: .62 }}>{formatDate(item.recommended_at)}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: 12, alignItems: "center", marginTop: 18 }}>
              <div>
                <span style={labelStyle}>Observed subject</span>
                <strong style={{ display: "block", marginTop: 5, fontSize: 24 }}>{item.subject_label}</strong>
              </div>
              <span aria-hidden="true" style={{ fontSize: 24, opacity: .42 }}>→</span>
              <div>
                <span style={labelStyle}>Resolver recommendation</span>
                <strong style={{ display: "block", marginTop: 5, fontSize: 24 }}>{item.recommended_target_label}</strong>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 18 }}>
              <div><span style={labelStyle}>Relationship</span><strong style={{ display: "block", marginTop: 4 }}>{item.recommended_relationship}</strong></div>
              <div><span style={labelStyle}>Algorithm</span><strong style={{ display: "block", marginTop: 4 }}>{item.algorithm_key || "Unknown"} {item.algorithm_version ? `v${item.algorithm_version}` : ""}</strong></div>
              <div><span style={labelStyle}>Recommendation basis</span><strong style={{ display: "block", marginTop: 4 }}>{item.recommendation_basis || "Not recorded"}</strong></div>
            </div>

            {merge ? (
              <div style={{ marginTop: 18, padding: 14, borderRadius: 14, background: item.approval_ready ? "rgba(45,95,61,.08)" : "rgba(132,78,28,.09)" }}>
                <span style={labelStyle}>Hard-veto membrane</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "7px 18px", marginTop: 7, fontSize: 13, fontWeight: 800 }}>
                  <span>Required {item.hard_rules_required}</span>
                  <span>Evaluated {item.hard_rules_evaluated}</span>
                  <span>Failures {item.hard_veto_failures}</span>
                  <span>Unknowns {item.hard_unknowns}</span>
                  <span>{item.approval_ready ? "Approval ready" : "Approval blocked"}</span>
                </div>
              </div>
            ) : null}

            <details style={{ marginTop: 18 }}>
              <summary style={{ cursor: "pointer", fontWeight: 850 }}>Inspect evidence packet</summary>
              <div style={{ marginTop: 12, padding: 14, borderRadius: 14, background: "rgba(38,38,38,.045)" }}>
                <Evidence item={item} />
              </div>
            </details>

            <div style={{ marginTop: 18 }}>
              <label htmlFor={`basis-${item.review_id}`} style={labelStyle}>Reviewer reason · required</label>
              <textarea
                id={`basis-${item.review_id}`}
                value={basisById[item.review_id] ?? ""}
                onChange={(event) => setBasisById((current) => ({ ...current, [item.review_id]: event.target.value }))}
                placeholder="Record why the evidence does or does not establish the proposed identity."
                rows={4}
                maxLength={4000}
                style={{ width: "100%", marginTop: 7, resize: "vertical", border: "1px solid rgba(38,38,38,.18)", borderRadius: 12, padding: 12, font: "inherit", background: "rgba(255,255,255,.9)", boxSizing: "border-box" }}
              />
            </div>

            {error ? <p role="alert" style={{ margin: "10px 0 0", fontWeight: 800 }}>{error}</p> : null}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
              <button
                type="button"
                disabled={Boolean(busyKey) || (merge && !item.approval_ready)}
                onClick={() => adjudicate(item, "approved")}
                style={{ border: 0, borderRadius: 999, padding: "11px 18px", fontWeight: 900, cursor: "pointer", background: "#262626", color: "#fff", opacity: Boolean(busyKey) || (merge && !item.approval_ready) ? .45 : 1 }}
              >
                {approveBusy ? "Recording…" : "Approve identity"}
              </button>
              <button
                type="button"
                disabled={Boolean(busyKey)}
                onClick={() => adjudicate(item, "rejected")}
                style={{ border: "1px solid rgba(38,38,38,.24)", borderRadius: 999, padding: "11px 18px", fontWeight: 900, cursor: "pointer", background: "transparent", color: "inherit", opacity: Boolean(busyKey) ? .45 : 1 }}
              >
                {rejectBusy ? "Recording…" : "Reject recommendation"}
              </button>
            </div>

            <p style={{ margin: "13px 0 0", fontSize: 12, lineHeight: 1.5, opacity: .62 }}>
              {merge
                ? "Approval records a human identity decision only. Execution remains not_executed, and this workspace has no canonical-merge control."
                : "Approval accepts exactly the Resolver-recommended entity. Rejection preserves the source candidate for future resolution rather than declaring the source record invalid."}
            </p>
          </section>
        );
      })}
    </div>
  );
}
