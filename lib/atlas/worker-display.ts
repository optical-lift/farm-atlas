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

export type AtlasWorkerResourceComponent = {
  key: string;
  label: string;
};

type AtlasWorkerResourceComponentInput = {
  resource_key?: unknown;
  resource_label?: unknown;
};

/**
 * Worker-visible resources are closed-vocabulary components. A requirement is
 * renderable only when it resolves to both a canonical resource key and its
 * canonical label. Per-task notes, statuses, and other annotations are not a
 * worker display surface and are intentionally discarded here.
 */
export function atlasWorkerResourceComponent(
  value: AtlasWorkerResourceComponentInput | null | undefined,
): AtlasWorkerResourceComponent | null {
  const key = typeof value?.resource_key === "string" ? value.resource_key.trim() : "";
  const label = typeof value?.resource_label === "string" ? value.resource_label.trim() : "";
  if (!key || !label) return null;
  return { key, label };
}

export function atlasWorkerResourceComponents(
  values: ReadonlyArray<AtlasWorkerResourceComponentInput> | null | undefined,
): AtlasWorkerResourceComponent[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => atlasWorkerResourceComponent(value))
    .filter((value): value is AtlasWorkerResourceComponent => value !== null);
}
