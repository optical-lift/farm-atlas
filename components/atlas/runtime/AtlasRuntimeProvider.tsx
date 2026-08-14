"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ATLAS_WORKER_DAY_RUNTIME_INVALIDATE_EVENT } from "@/lib/atlas/runtime-events";
import {
  applyAtlasRuntimePendingActions,
  type AtlasRuntimePendingAction,
} from "@/lib/atlas/runtime-reconciliation";
import {
  commitAtlasTaskTransition,
  type AtlasTaskTransitionRequest,
  type AtlasTaskTransitionResponse,
} from "@/lib/atlas/task-transition-client";
import {
  readAtlasWorkerDayProjection,
  type AtlasWorkerDayProjectionRead,
} from "@/lib/atlas/worker-day-projection-client";

type WorkerDayRuntimeEntry = {
  canonicalValue: AtlasWorkerDayProjectionRead | null;
  value: AtlasWorkerDayProjectionRead | null;
  pendingActions: AtlasRuntimePendingAction[];
  error: string | null;
  loading: boolean;
  requestId: number;
};

type WorkerDayReadOptions = {
  force?: boolean;
};

type RuntimeTaskTransitionInput = {
  serviceDate: string;
  request: AtlasTaskTransitionRequest;
};

type AtlasRuntimeContextValue = {
  scopeKey: string;
  version: number;
  peekWorkerDay: (dateIso: string) => WorkerDayRuntimeEntry | null;
  readWorkerDay: (dateIso: string, options?: WorkerDayReadOptions) => Promise<AtlasWorkerDayProjectionRead>;
  invalidateWorkerDay: (dateIso?: string) => void;
  dispatchTaskTransition: (input: RuntimeTaskTransitionInput) => Promise<AtlasTaskTransitionResponse>;
};

const AtlasRuntimeContext = createContext<AtlasRuntimeContextValue | null>(null);

function runtimeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Atlas could not load the worker Day projection.";
}

function runtimeEntry(input: {
  canonicalValue: AtlasWorkerDayProjectionRead | null;
  pendingActions?: AtlasRuntimePendingAction[];
  error?: string | null;
  loading?: boolean;
  requestId?: number;
}): WorkerDayRuntimeEntry {
  const pendingActions = input.pendingActions ?? [];
  return {
    canonicalValue: input.canonicalValue,
    value: applyAtlasRuntimePendingActions(input.canonicalValue, pendingActions),
    pendingActions,
    error: input.error ?? null,
    loading: input.loading ?? false,
    requestId: input.requestId ?? 0,
  };
}

export default function AtlasRuntimeProvider({
  children,
  scopeKey,
}: {
  children: ReactNode;
  scopeKey: string;
}) {
  const entriesRef = useRef(new Map<string, WorkerDayRuntimeEntry>());
  const inFlightRef = useRef(new Map<string, Promise<AtlasWorkerDayProjectionRead>>());
  const requestSequenceRef = useRef(0);
  const actionSequenceRef = useRef(0);
  const [version, setVersion] = useState(0);

  const notify = useCallback(() => setVersion((current) => current + 1), []);

  const invalidateWorkerDay = useCallback((dateIso?: string) => {
    if (dateIso) {
      entriesRef.current.delete(dateIso);
      inFlightRef.current.delete(dateIso);
    } else {
      entriesRef.current.clear();
      inFlightRef.current.clear();
    }
    notify();
  }, [notify]);

  const peekWorkerDay = useCallback((dateIso: string) => entriesRef.current.get(dateIso) ?? null, []);

  const readWorkerDay = useCallback(async (
    dateIso: string,
    options: WorkerDayReadOptions = {},
  ) => {
    const cached = entriesRef.current.get(dateIso);
    if (!options.force && cached?.value) return cached.value;

    const existingRequest = inFlightRef.current.get(dateIso);
    if (!options.force && existingRequest) return existingRequest;

    const requestId = ++requestSequenceRef.current;
    entriesRef.current.set(dateIso, runtimeEntry({
      canonicalValue: cached?.canonicalValue ?? null,
      pendingActions: cached?.pendingActions ?? [],
      error: null,
      loading: true,
      requestId,
    }));
    notify();

    const request = readAtlasWorkerDayProjection(dateIso)
      .then((canonicalValue) => {
        const current = entriesRef.current.get(dateIso);
        if (current?.requestId === requestId) {
          entriesRef.current.set(dateIso, runtimeEntry({
            canonicalValue,
            pendingActions: current.pendingActions,
            error: null,
            loading: false,
            requestId,
          }));
          notify();
        }
        return applyAtlasRuntimePendingActions(canonicalValue, current?.pendingActions ?? []) ?? canonicalValue;
      })
      .catch((error) => {
        const current = entriesRef.current.get(dateIso);
        if (current?.requestId === requestId) {
          entriesRef.current.set(dateIso, runtimeEntry({
            canonicalValue: current.canonicalValue,
            pendingActions: current.pendingActions,
            error: runtimeErrorMessage(error),
            loading: false,
            requestId,
          }));
          notify();
        }
        throw error;
      })
      .finally(() => {
        if (inFlightRef.current.get(dateIso) === request) inFlightRef.current.delete(dateIso);
      });

    inFlightRef.current.set(dateIso, request);
    return request;
  }, [notify]);

  const dispatchTaskTransition = useCallback(async (input: RuntimeTaskTransitionInput) => {
    if (!entriesRef.current.get(input.serviceDate)?.canonicalValue) {
      await readWorkerDay(input.serviceDate);
    }

    const actionId = `runtime-task-transition:${++actionSequenceRef.current}`;
    const current = entriesRef.current.get(input.serviceDate);
    const action: AtlasRuntimePendingAction = {
      actionId,
      kind: "task_transition",
      serviceDate: input.serviceDate,
      taskId: input.request.taskId,
      transition: input.request.transition,
      phase: "committing",
    };
    entriesRef.current.set(input.serviceDate, runtimeEntry({
      canonicalValue: current?.canonicalValue ?? null,
      pendingActions: [...(current?.pendingActions ?? []), action],
      error: null,
      loading: current?.loading ?? false,
      requestId: current?.requestId ?? 0,
    }));
    notify();

    let response: AtlasTaskTransitionResponse;
    try {
      response = await commitAtlasTaskTransition(input.request);
    } catch (error) {
      const failed = entriesRef.current.get(input.serviceDate);
      entriesRef.current.set(input.serviceDate, runtimeEntry({
        canonicalValue: failed?.canonicalValue ?? null,
        pendingActions: (failed?.pendingActions ?? []).filter((pending) => pending.actionId !== actionId),
        error: runtimeErrorMessage(error),
        loading: failed?.loading ?? false,
        requestId: failed?.requestId ?? 0,
      }));
      notify();
      throw error;
    }

    const committed = entriesRef.current.get(input.serviceDate);
    entriesRef.current.set(input.serviceDate, runtimeEntry({
      canonicalValue: committed?.canonicalValue ?? null,
      pendingActions: (committed?.pendingActions ?? []).map((pending) => (
        pending.actionId === actionId ? { ...pending, phase: "reconciling" as const } : pending
      )),
      error: null,
      loading: committed?.loading ?? false,
      requestId: committed?.requestId ?? 0,
    }));
    notify();

    try {
      await readWorkerDay(input.serviceDate, { force: true });
      const reconciled = entriesRef.current.get(input.serviceDate);
      entriesRef.current.set(input.serviceDate, runtimeEntry({
        canonicalValue: reconciled?.canonicalValue ?? null,
        pendingActions: (reconciled?.pendingActions ?? []).filter((pending) => pending.actionId !== actionId),
        error: reconciled?.error ?? null,
        loading: reconciled?.loading ?? false,
        requestId: reconciled?.requestId ?? 0,
      }));
      notify();
    } catch {
      // The canonical command already succeeded. Keep its overlay visible and
      // marked reconciling until an explicit or later authoritative read lands.
    }

    return response;
  }, [notify, readWorkerDay]);

  useEffect(() => {
    const invalidate = () => invalidateWorkerDay();
    window.addEventListener(ATLAS_WORKER_DAY_RUNTIME_INVALIDATE_EVENT, invalidate);
    return () => window.removeEventListener(ATLAS_WORKER_DAY_RUNTIME_INVALIDATE_EVENT, invalidate);
  }, [invalidateWorkerDay]);

  const value = useMemo<AtlasRuntimeContextValue>(() => ({
    scopeKey,
    version,
    peekWorkerDay,
    readWorkerDay,
    invalidateWorkerDay,
    dispatchTaskTransition,
  }), [scopeKey, version, peekWorkerDay, readWorkerDay, invalidateWorkerDay, dispatchTaskTransition]);

  return <AtlasRuntimeContext.Provider value={value}>{children}</AtlasRuntimeContext.Provider>;
}

export function useAtlasWorkerDayProjection(dateIso: string) {
  const runtime = useContext(AtlasRuntimeContext);
  if (!runtime) throw new Error("useAtlasWorkerDayProjection must be used inside AtlasRuntimeProvider.");

  const entry = runtime.peekWorkerDay(dateIso);

  useEffect(() => {
    if (!entry) {
      void runtime.readWorkerDay(dateIso).catch(() => undefined);
    }
  }, [dateIso, entry, runtime]);

  const reload = useCallback(async () => {
    await runtime.readWorkerDay(dateIso, { force: true });
  }, [dateIso, runtime]);

  return {
    projection: entry?.value?.projection ?? null,
    canManage: entry?.value?.canManage ?? false,
    loading: entry?.loading ?? true,
    error: entry?.error ?? null,
    pendingActions: entry?.pendingActions ?? [],
    reload,
    runtimeScopeKey: runtime.scopeKey,
  };
}

export function useAtlasRuntimeActions() {
  const runtime = useContext(AtlasRuntimeContext);
  if (!runtime) throw new Error("useAtlasRuntimeActions must be used inside AtlasRuntimeProvider.");
  return { dispatchTaskTransition: runtime.dispatchTaskTransition };
}
