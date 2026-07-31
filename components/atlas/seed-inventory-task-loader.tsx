"use client";

import { useEffect, useState } from "react";

import SeedInventoryFocusPage, { type SeedInventoryFocusTask } from "@/app/task-focus/[taskId]/SeedInventoryFocusPage";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type Dependency = {
  productionLotLabel?: string;
  plannedSowDate?: string | null;
  outstandingQuantity?: number | string;
  coveredByTrustedInventory?: boolean;
};

type SeedLot = {
  seedLotId?: string;
  lotLabel?: string;
  cropLabel?: string;
  variety?: string | null;
  storageLocation?: string | null;
  quantityUnit?: string;
  recordedReceiptQuantity?: number | string;
  observationStatus?: string;
  verifiedOnHandQuantity?: number | string | null;
  projectedOnHandQuantity?: number | string | null;
  outstandingReservedQuantity?: number | string;
  lastVerifiedAt?: string | null;
  stateNote?: string | null;
  dependencies?: Dependency[];
};

type Dashboard = {
  ok?: boolean;
  error?: string;
  canManage?: boolean;
  items?: SeedLot[];
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function SeedInventoryTaskLoader({ task }: Props) {
  const [focus, setFocus] = useState<SeedInventoryFocusTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seedLotId = text(task.metadata?.seed_lot_id);

  useEffect(() => {
    async function load() {
      try {
        setError(null);
        const response = await fetch("/api/atlas/seed-inventory", { headers: { Accept: "application/json" }, cache: "no-store" });
        const data = await response.json() as Dashboard;
        if (!response.ok || !data.ok) throw new Error(data.error || "Seed inventory failed.");
        const item = (data.items ?? []).find((candidate) => candidate.seedLotId === seedLotId);
        if (!item) throw new Error("This seed lot is not available in the active farm inventory.");

        const recordedReceiptQuantity = number(item.recordedReceiptQuantity ?? task.metadata?.recorded_receipt_quantity);
        const projectedOnHand = item.projectedOnHandQuantity === null || item.projectedOnHandQuantity === undefined
          ? null
          : number(item.projectedOnHandQuantity);
        const verifiedOnHand = item.verifiedOnHandQuantity === null || item.verifiedOnHandQuantity === undefined
          ? null
          : number(item.verifiedOnHandQuantity);

        setFocus({
          id: task.task_id,
          title: task.title,
          dueDate: task.due_date,
          lotLabel: text(item.lotLabel) || text(task.metadata?.seed_lot_label) || task.title,
          cropLabel: text(item.cropLabel) || text(task.metadata?.crop_label) || "Seed",
          variety: text(item.variety) || text(task.metadata?.variety) || null,
          storageLocation: text(item.storageLocation) || text(task.metadata?.storage_location) || null,
          quantityUnit: text(item.quantityUnit) || text(task.metadata?.quantity_unit) || "units",
          recordedReceiptQuantity,
          expectedQuantity: projectedOnHand ?? recordedReceiptQuantity,
          verifiedOnHandQuantity: verifiedOnHand,
          lastVerifiedAt: text(item.lastVerifiedAt) || null,
          outstandingReservedQuantity: number(item.outstandingReservedQuantity),
          observationStatus: text(item.observationStatus) || "verification_required",
          currentNote: text(item.stateNote) || null,
          dependencies: (item.dependencies ?? []).map((dependency) => ({
            label: text(dependency.productionLotLabel) || "Production lot",
            plannedSowDate: text(dependency.plannedSowDate) || null,
            outstandingQuantity: number(dependency.outstandingQuantity),
            covered: Boolean(dependency.coveredByTrustedInventory),
          })),
          canRetire: Boolean(data.canManage),
          returnTo: "/inventory/seeds",
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Seed inventory failed.");
      }
    }
    if (seedLotId) void load();
    else setError("This recount is missing its canonical seed-lot link.");
  }, [seedLotId, task]);

  if (error) {
    return <main className="atlas-phone-shell"><section className="atlas-phone"><div className="atlas-task-page-empty error">{error}</div></section></main>;
  }
  if (!focus) {
    return <main className="atlas-phone-shell"><section className="atlas-phone"><div className="atlas-task-page-empty">Loading physical seed count.</div></section></main>;
  }
  return <SeedInventoryFocusPage task={focus} />;
}
