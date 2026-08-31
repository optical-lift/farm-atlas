export type AtlasInputPrimitive = "quantity" | "choice";

export type AtlasInputSourceRef = {
  domain: string;
  jurisdiction: string;
  objectRef: string;
  claimRef?: string;
};

export type AtlasQuantityInputField = {
  primitive: "quantity";
  id: string;
  label: string;
  unit: string;
  displayUnit: string;
  displayUnitSingular?: string;
  step?: number;
  minimum?: number;
  initialValue?: number;
  startUnset?: boolean;
  inputMode?: "normal" | "blind_measurement";
};

export type AtlasChoiceInputField = {
  primitive: "choice";
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  initialValue?: string;
};

export type AtlasInputField = AtlasQuantityInputField | AtlasChoiceInputField;

export type AtlasInputRule =
  | {
      kind: "minimum_quantity_total";
      fieldIds: string[];
      minimum: number;
      message: string;
    }
  | {
      kind: "required_field";
      fieldId: string;
      message: string;
    };

export type AtlasInputContract = {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  source: AtlasInputSourceRef;
  fields: AtlasInputField[];
  rules: AtlasInputRule[];
  resultEventType: string;
  persistence: "fixture_only" | "canonical";
  sourceContext?: Record<string, string | number | boolean | null>;
};

export type AtlasInputValue = number | string | null;
export type AtlasInputValues = Record<string, AtlasInputValue>;

export type AtlasInputValidation = {
  ok: boolean;
  issues: Array<{ rule: AtlasInputRule["kind"]; message: string }>;
};

export type AtlasInputResultEvent = {
  eventType: string;
  contractId: string;
  source: AtlasInputSourceRef;
  persistence: AtlasInputContract["persistence"];
  recordedAt: string;
  values: AtlasInputValues;
  aggregates: {
    quantityTotal: number;
    quantityUnit: string | null;
  };
  sourceContext: Record<string, string | number | boolean | null>;
};

export function initialAtlasInputValues(contract: AtlasInputContract): AtlasInputValues {
  return Object.fromEntries(contract.fields.map((field) => [
    field.id,
    field.primitive === "quantity"
      ? field.startUnset
        ? null
        : field.initialValue ?? 0
      : field.initialValue ?? "",
  ]));
}

export function quantityFields(contract: AtlasInputContract) {
  return contract.fields.filter((field): field is AtlasQuantityInputField => field.primitive === "quantity");
}

export function choiceFields(contract: AtlasInputContract) {
  return contract.fields.filter((field): field is AtlasChoiceInputField => field.primitive === "choice");
}

export function quantityTotal(contract: AtlasInputContract, values: AtlasInputValues, fieldIds?: string[]) {
  const ids = fieldIds ? new Set(fieldIds) : null;
  return quantityFields(contract)
    .filter((field) => !ids || ids.has(field.id))
    .reduce((sum, field) => {
      const value = values[field.id];
      return sum + (typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0);
    }, 0);
}

export function validateAtlasInput(contract: AtlasInputContract, values: AtlasInputValues): AtlasInputValidation {
  const issues: AtlasInputValidation["issues"] = [];

  for (const rule of contract.rules) {
    if (rule.kind === "minimum_quantity_total") {
      if (quantityTotal(contract, values, rule.fieldIds) < rule.minimum) {
        issues.push({ rule: rule.kind, message: rule.message });
      }
      continue;
    }

    const value = values[rule.fieldId];
    const present = typeof value === "number"
      ? Number.isFinite(value)
      : typeof value === "string"
        ? Boolean(value.trim())
        : value !== null && value !== undefined;
    if (!present) issues.push({ rule: rule.kind, message: rule.message });
  }

  return { ok: issues.length === 0, issues };
}

export function createAtlasInputResultEvent(
  contract: AtlasInputContract,
  values: AtlasInputValues,
  recordedAt = new Date(),
): AtlasInputResultEvent {
  const validation = validateAtlasInput(contract, values);
  if (!validation.ok) {
    throw new Error(`Atlas input result is incomplete: ${validation.issues.map((issue) => issue.message).join(" ")}`);
  }

  const quantity = quantityFields(contract);
  const units = new Set(quantity.map((field) => field.unit));

  return {
    eventType: contract.resultEventType,
    contractId: contract.id,
    source: contract.source,
    persistence: contract.persistence,
    recordedAt: recordedAt.toISOString(),
    values: { ...values },
    aggregates: {
      quantityTotal: quantityTotal(contract, values),
      quantityUnit: units.size === 1 ? quantity[0]?.unit ?? null : null,
    },
    sourceContext: { ...(contract.sourceContext ?? {}) },
  };
}
