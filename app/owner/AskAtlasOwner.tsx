"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";

type AskEvidence = {
  id: string;
  kind: string;
  label: string;
  detail: string;
  href: string | null;
};

type ReconciliationClaim = {
  id: string;
  text: string;
  statementType: string;
  subject: string | null;
  evidenceIds: string[];
  evidenceMatch: string;
  ownerAttention: "none" | "fyi" | "decision_required";
  note: string;
  sourceLabel: string;
  sourceAuthority: "reporting_only";
  permittedStateEffect: "append_source_attributed_evidence_only";
  governingStateChanged: false;
  classification: string;
  classificationLabel: string;
};

type AskResponse = {
  ok: boolean;
  mode?: "reconciliation";
  sourceLabel?: string;
  reportText?: string;
  summary?: string;
  claims?: ReconciliationClaim[];
  evidence?: AskEvidence[];
  limitations?: string | null;
  answeredForDate?: string;
  readOnly?: boolean;
  noRecordsChanged?: boolean;
  proposalFirewall?: "blocked";
  error?: string;
};

type AskAtlasOwnerProps = {
  defaultSourceLabel?: string;
};

export default function AskAtlasOwner({ defaultSourceLabel = "" }: AskAtlasOwnerProps) {
  const [sourceLabel, setSourceLabel] = useState(defaultSourceLabel);
  const [reportText, setReportText] = useState("");
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  async function reconcile() {
    const clean = reportText.trim();
    if (!clean || loading) return;
    setLoading(true);
    const id = ++requestId.current;

    try {
      const result = await fetch("/api/owner/ask-atlas/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportText: clean,
          sourceLabel: sourceLabel.trim() || "Worker",
        }),
      });
      const payload = await result.json() as AskResponse;
      if (id !== requestId.current) return;
      setResponse(payload.ok ? payload : { ok: false, error: payload.error || "Atlas couldn’t reconcile that report just now." });
    } catch {
      if (id !== requestId.current) return;
      setResponse({ ok: false, error: "Atlas couldn’t reconcile that report just now. Nothing was changed." });
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void reconcile();
  }

  const evidenceById = new Map((response?.evidence ?? []).map((item) => [item.id, item]));

  return (
    <section className="atlas-owner-ask" aria-live="polite">
      <div className="atlas-owner-ask__heading">
        <div>
          <span>Reality reconciliation</span>
          <strong>Ask Atlas</strong>
        </div>
        <small>Read-only</small>
      </div>

      <p className="atlas-owner-ask__intro">
        Paste a field update. Atlas will compare what was reported with the work it can already see without completing, reprioritizing, or changing anything.
      </p>

      <form className="atlas-owner-ask__reconcile-form" onSubmit={submit}>
        <label className="atlas-owner-ask__source">
          <span>Reported by</span>
          <input
            maxLength={120}
            value={sourceLabel}
            onChange={(event) => setSourceLabel(event.target.value)}
            placeholder="Anna"
          />
        </label>
        <label className="atlas-owner-ask__report">
          <span>Field update</span>
          <textarea
            rows={7}
            maxLength={4000}
            value={reportText}
            onChange={(event) => setReportText(event.target.value)}
            placeholder="Paste the text or update exactly as it was sent…"
          />
        </label>
        <button type="submit" disabled={loading || !reportText.trim()}>{loading ? "Reconciling…" : "Reconcile with Atlas"}</button>
      </form>

      {response ? (
        <div className={`atlas-owner-ask__answer${response.ok ? "" : " is-error"}`}>
          {response.ok ? (
            <>
              <p>{response.summary}</p>

              {response.claims?.length ? (
                <div className="atlas-owner-ask__claims">
                  <span>What Atlas heard</span>
                  {response.claims.map((claim) => (
                    <article key={claim.id} data-classification={claim.classification}>
                      <header>
                        <strong>{claim.classificationLabel}</strong>
                        {claim.ownerAttention !== "none" ? <small>{claim.ownerAttention === "decision_required" ? "Owner decision" : "Owner FYI"}</small> : null}
                      </header>
                      <p>{claim.text}</p>
                      {claim.note ? <small>{claim.note}</small> : null}
                      {claim.evidenceIds.length ? (
                        <div className="atlas-owner-ask__claim-evidence">
                          {claim.evidenceIds.map((evidenceId) => {
                            const item = evidenceById.get(evidenceId);
                            if (!item) return null;
                            return item.href
                              ? <Link href={item.href} key={evidenceId}>{item.label}</Link>
                              : <span key={evidenceId}>{item.label}</span>;
                          })}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}

              <div className="atlas-owner-ask__custody">
                <strong>No records changed.</strong>
                <span>Worker statements remain attributed evidence. Recommendations cannot become priority changes or managing directives.</span>
              </div>

              {response.evidence?.length ? (
                <details className="atlas-owner-ask__evidence">
                  <summary>Atlas records consulted</summary>
                  <div>
                    {response.evidence.map((item) => {
                      const content = (
                        <>
                          <strong>{item.label}</strong>
                          <small>{item.detail}</small>
                        </>
                      );
                      return item.href ? <Link href={item.href} key={item.id}>{content}</Link> : <div key={item.id}>{content}</div>;
                    })}
                  </div>
                </details>
              ) : null}

              {response.limitations ? <small className="atlas-owner-ask__limits">{response.limitations}</small> : null}
            </>
          ) : <p>{response.error}</p>}
        </div>
      ) : null}
    </section>
  );
}
