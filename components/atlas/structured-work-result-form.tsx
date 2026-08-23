"use client";

import { useEffect, useMemo, useState } from "react";

type ResultField = {
  fieldKey: string;
  label: string;
  valueKind: "text" | "number" | "boolean" | "date" | "choice";
  unit?: string | null;
  required?: boolean;
  choices?: string[];
  sortOrder?: number;
};

type ResultSubmission = {
  submissionId: string;
  submittedAt: string;
  values: Record<string, unknown>;
};

type ResultContract = {
  taskId: string;
  fields: ResultField[];
  submissions: ResultSubmission[];
};

type ApiResponse = {
  ok?: boolean;
  contract?: ResultContract;
  error?: string | { message?: string };
  details?: string;
};

type Props = {
  taskId: string;
  heading?: string;
  submitLabel?: string;
  onSaved?: (contract: ResultContract) => void;
};

function requestError(data: ApiResponse) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  return data.error?.message || "Result save failed.";
}

function choiceLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function emptyValues(fields: ResultField[]) {
  return Object.fromEntries(fields.map((field) => [field.fieldKey, field.valueKind === "boolean" ? false : ""]));
}

export default function StructuredWorkResultForm({
  taskId,
  heading = "Result",
  submitLabel = "Save",
  onSaved,
}: Props) {
  const [contract, setContract] = useState<ResultContract | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fields = useMemo(
    () => [...(contract?.fields ?? [])].sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100) || a.fieldKey.localeCompare(b.fieldKey)),
    [contract],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setMessage(null);
    void fetch(`/api/atlas/work-result?taskId=${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as ApiResponse;
        if (!response.ok || !data.ok || !data.contract) throw new Error(requestError(data));
        return data.contract;
      })
      .then((next) => {
        setContract(next);
        setValues(emptyValues(next.fields));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage(error instanceof Error ? error.message : "Result load failed.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [taskId]);

  async function save() {
    if (!contract || saving) return;
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = values[field.fieldKey];
      if (field.valueKind === "boolean") {
        payload[field.fieldKey] = Boolean(raw);
        continue;
      }
      const text = typeof raw === "string" ? raw.trim() : "";
      if (!text) continue;
      payload[field.fieldKey] = field.valueKind === "number" ? Number(text) : text;
    }

    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/work-result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-atlas-intent": "structured-work-result-v1",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          taskId,
          values: payload,
          idempotencyKey: `work-result:${taskId}:${Date.now()}:${crypto.randomUUID()}`,
        }),
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok || !data.ok || !data.contract) throw new Error(requestError(data));
      setContract(data.contract);
      setValues(emptyValues(data.contract.fields));
      onSaved?.(data.contract);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Result save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="atlas-structured-result__status">Loading</p>;
  if (!contract || !fields.length) return message ? <p className="atlas-structured-result__error">{message}</p> : null;

  return (
    <section className="atlas-structured-result" aria-label={heading}>
      <div className="atlas-structured-result__head">
        <strong>{heading}</strong>
        {contract.submissions.length ? <span>{contract.submissions.length} saved</span> : null}
      </div>
      <div className="atlas-structured-result__fields">
        {fields.map((field) => {
          const value = values[field.fieldKey];
          return (
            <label className="atlas-structured-result__field" key={field.fieldKey}>
              <span>{field.label}{field.unit ? ` · ${field.unit}` : ""}</span>
              {field.valueKind === "choice" ? (
                <select
                  value={typeof value === "string" ? value : ""}
                  required={Boolean(field.required)}
                  disabled={saving}
                  onChange={(event) => setValues((current) => ({ ...current, [field.fieldKey]: event.target.value }))}
                >
                  <option value="">—</option>
                  {(field.choices ?? []).map((choice) => <option value={choice} key={choice}>{choiceLabel(choice)}</option>)}
                </select>
              ) : field.valueKind === "boolean" ? (
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  disabled={saving}
                  onChange={(event) => setValues((current) => ({ ...current, [field.fieldKey]: event.target.checked }))}
                />
              ) : (
                <input
                  type={field.valueKind === "number" ? "number" : field.valueKind === "date" ? "date" : "text"}
                  step={field.valueKind === "number" ? "any" : undefined}
                  value={typeof value === "string" ? value : ""}
                  required={Boolean(field.required)}
                  disabled={saving}
                  onChange={(event) => setValues((current) => ({ ...current, [field.fieldKey]: event.target.value }))}
                />
              )}
            </label>
          );
        })}
      </div>
      <button className="atlas-structured-result__save" type="button" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving" : submitLabel}
      </button>
      {message ? <p className="atlas-structured-result__error" aria-live="polite">{message}</p> : null}
      <style>{`
        .atlas-structured-result { display:grid; gap:12px; padding:14px; border:1px solid rgba(139,145,194,.22); border-radius:16px; background:rgba(246,242,230,.82); }
        .atlas-structured-result__head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .atlas-structured-result__head strong { font-size:.78rem; font-weight:950; letter-spacing:.08em; text-transform:uppercase; color:#686b7d; }
        .atlas-structured-result__head span { font-size:.72rem; font-weight:850; color:#777ca0; }
        .atlas-structured-result__fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
        .atlas-structured-result__field { display:grid; gap:5px; min-width:0; }
        .atlas-structured-result__field > span { font-size:.7rem; font-weight:900; color:#777ca0; }
        .atlas-structured-result__field input:not([type="checkbox"]), .atlas-structured-result__field select { width:100%; min-height:44px; padding:9px 10px; border:1px solid rgba(139,145,194,.28); border-radius:11px; background:#fff; color:#303145; font:inherit; }
        .atlas-structured-result__field input[type="checkbox"] { width:26px; height:26px; }
        .atlas-structured-result__save { min-height:46px; border:0; border-radius:12px; background:rgba(214,225,177,.9); color:#515b34; font-weight:950; }
        .atlas-structured-result__error,.atlas-structured-result__status { margin:0; color:#835345; font-size:.76rem; font-weight:850; }
        @media (max-width:560px) { .atlas-structured-result__fields { grid-template-columns:1fr; } }
      `}</style>
    </section>
  );
}
