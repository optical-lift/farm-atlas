const PLANNER_ONLY_PHRASES = [
  "mow by thursday",
  "friday–sunday visibility",
  "friday-sunday visibility",
  "if it was just mowed",
  "skip to the next useful thursday",
  "top of list",
  "after weeding",
  "last thing",
  "morning first",
  "first pass",
  "midday flex",
  "this morning only",
  "then move on to the rest of the day",
];

const PLANNER_ONLY_EXACT = new Set(["light"]);

export function atlasIsPlannerOnlyWorkerText(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  return Boolean(normalized)
    && (PLANNER_ONLY_EXACT.has(normalized)
      || PLANNER_ONLY_PHRASES.some((phrase) => normalized.includes(phrase)));
}

/**
 * Planner sequencing is allowed to order work internally without leaking as
 * worker instructions. Composite display strings keep their useful segments.
 */
export function atlasWorkerDisplayText(value: string | null | undefined) {
  const source = (value ?? "").trim();
  if (!source) return "";
  return source
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !atlasIsPlannerOnlyWorkerText(part))
    .join(" · ");
}

export function atlasWorkerDisplayLines(values: Array<string | null | undefined>) {
  return values.map(atlasWorkerDisplayText).filter(Boolean);
}
