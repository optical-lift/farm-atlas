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

type PersonAtlasInputSpreadProps = {
  kind: string;
  title: string;
  detail?: string;
  rows: PersonAtlasInputRow[];
  totalUnit: string;
  returnHref?: string;
  returnLabel?: string;
  recordLabel?: string;
};

function buildInitialValues(rows: PersonAtlasInputRow[]) {
  return Object.fromEntries(rows.map((row) => [row.id, Math.max(0, row.initialValue ?? 0)]));
}

export default function PersonAtlasInputSpread({
  kind,
  title,
  detail,
  rows,
  totalUnit,
  returnHref = "/owner",
  returnLabel = "today",
  recordLabel = "record",
}: PersonAtlasInputSpreadProps) {
  const [values, setValues] = useState<Record<string, number>>(() => buildInitialValues(rows));
  const [recorded, setRecorded] = useState(false);

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (values[row.id] ?? 0), 0),
    [rows, values],
  );

  const changeValue = (row: PersonAtlasInputRow, direction: -1 | 1) => {
    setRecorded(false);
    setValues((current) => {
      const step = Math.max(1, row.step ?? 1);
      const next = Math.max(0, (current[row.id] ?? 0) + step * direction);
      return { ...current, [row.id]: next };
    });
  };

  const typeValue = (row: PersonAtlasInputRow, rawValue: string) => {
    const parsed = Number.parseInt(rawValue.replace(/[^0-9]/g, ""), 10);
    setRecorded(false);
    setValues((current) => ({ ...current, [row.id]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 }));
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
            {rows.map((row) => (
              <div className={styles.inputRow} key={row.id}>
                <label htmlFor={`atlas-input-${row.id}`}>{row.label}</label>
                {recorded ? (
                  <strong className={styles.recordedValue}>{values[row.id] ?? 0}</strong>
                ) : (
                  <div className={styles.stepper}>
                    <button type="button" onClick={() => changeValue(row, -1)} aria-label={`Subtract ${row.label}`}>−</button>
                    <input
                      id={`atlas-input-${row.id}`}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={values[row.id] ?? 0}
                      onChange={(event) => typeValue(row, event.target.value)}
                      aria-label={`${row.label} quantity`}
                    />
                    <button type="button" onClick={() => changeValue(row, 1)} aria-label={`Add ${row.label}`}>+</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className={styles.totalRow}>
            <span>total</span>
            <strong>{total.toLocaleString()} <small>{totalUnit}</small></strong>
          </div>

          <div className={styles.actions}>
            {recorded ? (
              <>
                <button type="button" className={styles.secondaryAction} onClick={() => setRecorded(false)}>edit</button>
                <Link href={returnHref} className={styles.recordedMark}>recorded · back to {returnLabel}</Link>
              </>
            ) : (
              <button type="button" className={styles.recordAction} onClick={() => setRecorded(true)}>{recordLabel}</button>
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
