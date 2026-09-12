import { createAtlasServerClient } from "@/lib/supabase/server";

export type WorkerOperationalRouteObligation = {
  bindingId: string;
  obligationKind: "product" | "service" | "handoff" | "mixed";
  domainKey: string;
  quantity: number | null;
  unit: string | null;
  description: string;
};

export type WorkerOperationalRouteStop = {
  routeId: string;
  routeLabel: string;
  routeKind: "delivery" | "pickup" | "service" | "mixed" | "handoff";
  routeDate: string;
  routeState: string;
  stopId: string;
  sequenceNumber: number;
  stopKind: "product_delivery" | "product_pickup" | "service_visit" | "handoff" | "mixed";
  stopState: string;
  destinationLabel: string;
  addressText: string | null;
  contactName: string | null;
  contactDetail: string | null;
  serviceWindowStart: string | null;
  serviceWindowEnd: string | null;
  workerInstruction: string | null;
  executionTaskId: string | null;
  obligations: WorkerOperationalRouteObligation[];
};

type RpcRow = {
  route_id?: unknown;
  route_label?: unknown;
  route_kind?: unknown;
  route_date?: unknown;
  route_state?: unknown;
  stop_id?: unknown;
  sequence_number?: unknown;
  stop_kind?: unknown;
  stop_state?: unknown;
  destination_label?: unknown;
  address_text?: unknown;
  contact_name?: unknown;
  contact_detail?: unknown;
  service_window_start?: unknown;
  service_window_end?: unknown;
  worker_instruction?: unknown;
  execution_task_id?: unknown;
  obligations?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseObligations(value: unknown): WorkerOperationalRouteObligation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const bindingId = text(row.bindingId);
    const obligationKind = text(row.obligationKind);
    const domainKey = text(row.domainKey);
    const description = text(row.description);
    if (!bindingId || !domainKey || !description || !["product", "service", "handoff", "mixed"].includes(obligationKind ?? "")) return [];
    return [{
      bindingId,
      obligationKind: obligationKind as WorkerOperationalRouteObligation["obligationKind"],
      domainKey,
      quantity: numberOrNull(row.quantity),
      unit: text(row.unit),
      description,
    }];
  });
}

function parseStop(raw: RpcRow): WorkerOperationalRouteStop | null {
  const routeId = text(raw.route_id);
  const routeLabel = text(raw.route_label);
  const routeKind = text(raw.route_kind);
  const routeDate = text(raw.route_date);
  const routeState = text(raw.route_state);
  const stopId = text(raw.stop_id);
  const stopKind = text(raw.stop_kind);
  const stopState = text(raw.stop_state);
  const destinationLabel = text(raw.destination_label);
  const sequenceNumber = numberOrNull(raw.sequence_number);
  if (!routeId || !routeLabel || !routeDate || !routeState || !stopId || !stopState || !destinationLabel || sequenceNumber === null) return null;
  if (!["delivery", "pickup", "service", "mixed", "handoff"].includes(routeKind ?? "")) return null;
  if (!["product_delivery", "product_pickup", "service_visit", "handoff", "mixed"].includes(stopKind ?? "")) return null;
  return {
    routeId,
    routeLabel,
    routeKind: routeKind as WorkerOperationalRouteStop["routeKind"],
    routeDate,
    routeState,
    stopId,
    sequenceNumber,
    stopKind: stopKind as WorkerOperationalRouteStop["stopKind"],
    stopState,
    destinationLabel,
    addressText: text(raw.address_text),
    contactName: text(raw.contact_name),
    contactDetail: text(raw.contact_detail),
    serviceWindowStart: text(raw.service_window_start),
    serviceWindowEnd: text(raw.service_window_end),
    workerInstruction: text(raw.worker_instruction),
    executionTaskId: text(raw.execution_task_id),
    obligations: parseObligations(raw.obligations),
  };
}

export async function getWorkerOperationalRouteStopsForOrganization(
  organizationId: string,
  forDate: string,
): Promise<WorkerOperationalRouteStop[]> {
  const supabase = await createAtlasServerClient();
  const result = await supabase.rpc("worker_operational_route_stops_v1", {
    p_organization_id: organizationId,
    p_for_date: forDate,
  });
  if (result.error) throw new Error("Atlas worker route read failed.");
  const rows = Array.isArray(result.data) ? result.data as RpcRow[] : [];
  return rows.flatMap((row) => {
    const parsed = parseStop(row);
    return parsed ? [parsed] : [];
  });
}

export async function getWorkerOperationalRouteStopsForFarm(
  farmId: string,
  forDate: string,
): Promise<WorkerOperationalRouteStop[]> {
  const supabase = await createAtlasServerClient();
  const farm = await supabase.from("farms").select("organization_id").eq("id", farmId).maybeSingle();
  if (farm.error) throw new Error("Atlas farm organization read failed.");
  const organizationId = text((farm.data as { organization_id?: unknown } | null)?.organization_id);
  if (!organizationId) return [];
  return getWorkerOperationalRouteStopsForOrganization(organizationId, forDate);
}
