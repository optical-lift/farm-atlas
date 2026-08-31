"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  choiceFields,
  createAtlasInputResultEvent,
  initialAtlasInputValues,
  quantityFields,
  quantityTotal,
  validateAtlasInput,
  type AtlasInputContract,
  type AtlasInputResultEvent,
  type AtlasInputValues,
  type AtlasQuantityInputField,
} from "@/lib/atlas/input-contract";

import styles from "./person-atlas-input-spread.module.css";

type PersonAtlasInputSpreadProps = {
  contract: AtlasInputContract;
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

export default function PersonAtlasInputSpread({
  contract,
  returnHref = "/owner",
  returnLabel = "today",
  recordLabel = "record",
}: PersonAtlasInputSpreadProps) {
  const rows = useMemo(() => quantityFields(contract), [contract]);
  const choices = useMemo(() => choiceFields(contract), [contract]);
  const [values, setValues] = useState<AtlasInputValues>(() => initialAtlasInputValues(contract));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [recordedEvent, setRecordedEvent] = useState<AtlasInputResultEvent | null>(null);

  const total = useMemo(() => quantityTotal(contract, values), [contract, values]);
  const validation = useMemo(() => validateAtlasInput(contract, values), [contract, values]);
  const totalStep = rows.length && rows.every((row) => (row.step ?? 1) === (rows[0].step ?? 1))
    ? rows[0].step ?? 1
    : 1;
  const totalUnit = rows[0]?.displayUnit ?? "units";
  const totalUnitSingular = rows[0]?.displayUnitSingular;
  const totalUnitLabel = total === 1 && totalUnitSingular ? totalUnitSingular : totalUnit;
  const recorded = Boolean(recordedEvent);

  const changeValue = (row: AtlasQuantityInputField, direction: -1 | 1) => {
    setRecordedEvent(null);
    setDrafts((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    setValues((current) => {
      const step = row.step && row.step > 0 ? row.step : 1;
      const currentValue = typeof current[row.id] === "number" ? current[row.id] as number : 0;
      const next = normalizeValue(currentValue + step * direction, step);
      return { ...current, [row.id]: next };
    });
  };

  const typeValue = (row: AtlasQuantityInputField, rawValue: string) => {
    const cleaned = rawValue.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    setRecordedEvent(null);
    setDrafts((current) => ({ ...current, [row.id]: cleaned }));

    const parsed = Number.parseFloat(cleaned);
    if (!Number.isFinite(parsed)) return;
    setValues((current) => ({ ...current, [row.id]: Math.max(row.minimum ?? 0, parsed) }));
  };

  const settleTypedValue = (row: AtlasQuantityInputField) => {
    const step = row.step && row.step > 0 ? row.step : 1;
    const draftValue = drafts[row.id];
    setValues((current) => {
      const storedValue = current[row.id];
      if (row.startUnset && storedValue === null && (!draftValue || !draftValue.trim())) return current;
      const currentValue = typeof storedValue === "number" ? storedValue : 0;
      const next = normalizeValue(Math.max(row.minimum ?? 0, currentValue), step);
      return { ...current, [row.id]: next };
    });
    setDrafts((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
  };

  const record = () => {
    if (!validation.ok) return;
    setRecordedEvent(createAtlasInputResultEvent(contract, values));
  };

  return (
    <main
      className={styles.root}
      data-atlas-person-notebook-v2="true"
      data-atlas-input-spread="true"
      data-atlas-input-contract={contract.id}
      data-atlas-result-event-type={contract.resultEventType}
    >
      <section className={`${styles.page} ${styles.dotPage}`} aria-label={`${contract.kind} input spread`}>
        <header className={styles.topChrome}>
          <Link href={returnHref} className={styles.returnLink} aria-label={`Return to ${returnLabel}`}>
            <span aria-hidden="true">‹</span> {returnLabel}
          </Link>
          <span className={styles.kind}>{contract.kind}</span>
        </header>

        <article className={styles.spread}>
          <header className={styles.spreadHeader}>
            <h1>{contract.title}</h1>
            {contract.detail ? <p>{contract.detail}</p> : null}
          </header>

          <div className={styles.rows}>
            {rows.map((row) => {
              const step = row.step && row.step > 0 ? row.step : 1;
              const storedValue = values[row.id];
              const hasStoredValue = typeof storedValue === "number" && Number.isFinite(storedValue);
              const value = hasStoredValue ? storedValue : 0;
              return (
                <div className={styles.inputRow} key={row.id}>
                  <label htmlFor={`atlas-input-${row.id}`}>{row.label}</label>
                  {recorded ? (
                    <strong className={styles.recordedValue}>{hasStoredValue ? formatValue(value, step) : "not recorded"}</strong>
                  ) : (
                    <div className={styles.stepper}>
                      <button type="button" onClick={() => changeValue(row, -1)} aria-label={`Subtract ${step} from ${row.label}`}>−</button>
                      <input
                        id={`atlas-input-${row.id}`}
                        inputMode={step < 1 ? "decimal" : "numeric"}
                        value={drafts[row.id] ?? (hasStoredValue ? String(value) : "")}
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

          {rows.length > 1 ? (
            <div className={styles.totalRow}>
              <span>total</span>
              <strong>{formatValue(total, totalStep)} <small>{totalUnitLabel}</small></strong>
            </div>
          ) : null}

          {choices.map((choice) => {
            const selectedValue = typeof values[choice.id] === "string" ? values[choice.id] as string : "";
            const selectedChoice = choice.options.find((option) => option.value === selectedValue) ?? null;
            return (
              <div className={styles.followUp} key={choice.id}>
                <span>{choice.label}</span>
                {recorded ? (
                  <strong>{selectedChoice?.label ?? "not recorded"}</strong>
                ) : (
                  <div className={styles.followUpOptions}>
                    {choice.options.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        data-selected={selectedValue === option.value ? "true" : "false"}
                        onClick={() => {
                          setRecordedEvent(null);
                          setValues((current) => ({ ...current, [choice.id]: option.value }));
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div className={styles.actions}>
            {recorded ? (
              <>
                <button type="button" className={styles.secondaryAction} onClick={() => setRecordedEvent(null)}>edit</button>
                <Link href={returnHref} className={styles.recordedMark}>
                  {recordedEvent?.persistence === "fixture_only" ? "recorded in fixture" : "recorded"} · back to {returnLabel}
                </Link>
              </>
            ) : (
              <button type="button" className={styles.recordAction} disabled={!validation.ok} onClick={record}>{recordLabel}</button>
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
