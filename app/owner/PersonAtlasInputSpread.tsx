"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import styles from "./person-atlas-input-spread.module.css";

export type PersonAtlasInputRow = {
  id: string;
  label: string;
  initialValue?: number;
  step?: number;
};

export type PersonAtlasInputChoice = {
  label: string;
  value: string;
};

export type PersonAtlasInputFollowUp = {
  label: string;
  options: PersonAtlasInputChoice[];
  initialValue?: string;
  required?: boolean;
};

type PersonAtlasInputSpreadProps = {
  kind: string;
  title: string;
  detail?: string;
  rows: PersonAtlasInputRow[];
  totalUnit: string;
  totalUnitSingular?: string;
  minimumTotal?: number;
  followUp?: PersonAtlasInputFollowUp;
  returnHref?: string;
  returnLabel?: string;
  recordLabel?: string;
};

function stepPrecision(step: number) {
  const text = String(step);
  return text.includes(".") ? text.split(".")[1]?.length ?? 0 : 0;
}

function normalizeValue(value: number, step = 1) {
  const safeStep = step > 0 ? step : 1;
  const precision = Math.max(0, Math.min(4, stepPrecision(safeStep)));
  const snapped = Math.round(Math.max(0, value) / safeStep) * safeStep;
  return Number(snapped.toFixed(precision));
}

function formatValue(value: number, step = 1) {
  if (step === 0.5) {
    const halves = Math.round(value * 2);
    const whole = Math.floor(halves / 2);
    const hasHalf = halves % 2 === 1;
    if (!whole && hasHalf) return "½";
    return `${whole}${hasHalf ? "½" : ""}`;
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function buildInitialValues(rows: PersonAtlasInputRow[]) {
  return Object.fromEntries(
    rows.map((row) => [row.id, normalizeValue(row.initialValue ?? 0, row.step ?? 1)]),
  );
}

export default function PersonAtlasInputSpread({
  kind,
  title,
  detail,
  rows,
  totalUnit,
  totalUnitSingular,
  minimumTotal = 0,
  followUp,
  returnHref = "/owner",
  returnLabel = "today",
  recordLabel = "record",
}: PersonAtlasInputSpreadProps) {
  const [values, setValues] = useState<Record<string, number>>(() => buildInitialValues(rows));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [followUpValue, setFollowUpValue] = useState(followUp?.initialValue ?? "");
  const [recorded, setRecorded] = useState(false);

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (values[row.id] ?? 0), 0),
    [rows, values],
  );

  const totalStep = rows.length && rows.every((row) => (row.step ?? 1) === (rows[0].step ?? 1))
    ? rows[0].step ?? 1
    : 1;
  const selectedFollowUp = followUp?.options.find((option) => option.value === followUpValue) ?? null;
  const totalUnitLabel = total === 1 && totalUnitSingular ? totalUnitSingular : totalUnit;
  const recordReady = total >= minimumTotal && (!followUp?.required || Boolean(followUpValue));

  const changeValue = (row: PersonAtlasInputRow, direction: -1 | 1) => {
    setRecorded(false);
    setDrafts((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    setValues((current) => {
      const step = row.step && row.step > 0 ? row.step : 1;
      const next = normalizeValue((current[row.id] ?? 0) + step * direction, step);
      return { ...current, [row.id]: next };
    });
  };

  const typeValue = (row: PersonAtlasInputRow, rawValue: string) => {
    const cleaned = rawValue.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    setRecorded(false);
    setDrafts((current) => ({ ...current, [row.id]: cleaned }));

    const parsed = Number.parseFloat(cleaned);
    if (!Number.isFinite(parsed)) return;
    setValues((current) => ({ ...current, [row.id]: Math.max(0, parsed) }));
  };

  const settleTypedValue = (row: PersonAtlasInputRow) => {
    const step = row.step && row.step > 0 ? row.step : 1;
    setValues((current) => {
      const next = normalizeValue(current[row.id] ?? 0, step);
      return { ...current, [row.id]: next };
    });
    setDrafts((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
  };

  return (
    <main className={styles.root} data-atlas-person-notebook-v2="true" data-atlas-input-spread="true">
      <section className={`${styles.page} ${styles.dotPage}`} aria-label={`${kind} input spread`}>
        <header className={styles.topChrome}>
          <Link href={returnHref} className={styles.returnLink} aria-label={`Return to ${returnLabel}`}>
            <span aria-hidden="true">‹</span> {returnLabel}
          </Link>
          <span className={styles.kind}>{kind}</span>
        </header>

        <article className={styles.spread}>
          <header className={styles.spreadHeader}>
            <h1>{title}</h1>
            {detail ? <p>{detail}</p> : null}
          </header>

          <div className={styles.rows}>
            {rows.map((row) => {
              const step = row.step && row.step > 0 ? row.step : 1;
              const value = values[row.id] ?? 0;
              return (
                <div className={styles.inputRow} key={row.id}>
                  <label htmlFor={`atlas-input-${row.id}`}>{row.label}</label>
                  {recorded ? (
                    <strong className={styles.recordedValue}>{formatValue(value, step)}</strong>
                  ) : (
                    <div className={styles.stepper}>
                      <button type="button" onClick={() => changeValue(row, -1)} aria-label={`Subtract ${step} from ${row.label}`}>−</button>
                      <input
                        id={`atlas-input-${row.id}`}
                        inputMode={step < 1 ? "decimal" : "numeric"}
                        value={drafts[row.id] ?? String(value)}
                        onChange={(event) => typeValue(row, event.target.value)}
                        onBlur={() => settleTypedValue(row)}
                        aria-label={`${row.label} quantity`}
                      />
                      <button type="button" onClick={() => changeValue(row, 1)} aria-label={`Add ${step} to ${row.label}`}>+</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.totalRow}>
            <span>total</span>
            <strong>{formatValue(total, totalStep)} <small>{totalUnitLabel}</small></strong>
          </div>

          {followUp ? (
            <div className={styles.followUp}>
              <span>{followUp.label}</span>
              {recorded ? (
                <strong>{selectedFollowUp?.label ?? "not recorded"}</strong>
              ) : (
                <div className={styles.followUpOptions}>
                  {followUp.options.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      data-selected={followUpValue === option.value ? "true" : "false"}
                      onClick={() => {
                        setRecorded(false);
                        setFollowUpValue(option.value);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div className={styles.actions}>
            {recorded ? (
              <>
                <button type="button" className={styles.secondaryAction} onClick={() => setRecorded(false)}>edit</button>
                <Link href={returnHref} className={styles.recordedMark}>recorded · back to {returnLabel}</Link>
              </>
            ) : (
              <button type="button" className={styles.recordAction} disabled={!recordReady} onClick={() => setRecorded(true)}>{recordLabel}</button>
            )}
          </div>
        </article>

        <nav className={styles.pageNav} aria-label="Input spread navigation">
          <Link href={returnHref} aria-label={`Return to ${returnLabel}`}>‹</Link>
          <Link href={returnHref}>{returnLabel}</Link>
          <span>log</span>
          <span aria-hidden="true">·</span>
        </nav>
      </section>
    </main>
  );
}
