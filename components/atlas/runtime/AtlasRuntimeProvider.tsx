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

import {
  commitAtlasClockCommand,
  type AtlasClockCommand,
  type AtlasClockCommandResponse,
} from "@/lib/atlas/clock-command-client";
import { registerAtlasRuntimeTaskTransitionHandler } from "@/lib/atlas/runtime-action-bridge";
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

type AtlasRuntimeContextValue = {
  scopeKey: string;
  version: number;
  peekWorkerDay: (dateIso: string) => WorkerDayRuntimeEntry | null;
  readWorkerDay: (dateIso: string, options?: WorkerDayReadOptions) => Promise<AtlasWorkerDayProjectionRead>;
  invalidateWorkerDay: (dateIso?: string) => void;
  dispatchTaskTransition: (request: AtlasTaskTransitionRequest) => Promise<AtlasTaskTransitionResponse>;
  dispatchClockCommand: (command: AtlasClockCommand) => Promise<AtlasClockCommandResponse>;
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
        const pendingActions = (current?.pendingActions ?? []).filter((action) => action.phase !== "reconciling");
        if (current?.requestId === requestId) {
          entriesRef.current.set(dateIso, runtimeEntry({
            canonicalValue,
            pendingActions,
            error: null,
            loading: false,
            requestId,
          }));
          notify();
        }
        return applyAtlasRuntimePendingActions(canonicalValue, pendingActions) ?? canonicalValue;
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

  const dispatchTaskTransition = useCallback(async (request: AtlasTaskTransitionRequest) => {
    const serviceDates = Array.from(entriesRef.current.keys());
    if (!serviceDates.length) return commitAtlasTaskTransition(request);

    const actionId = `runtime-task-transition:${++actionSequenceRef.current}`;
    for (const serviceDate of serviceDates) {
      const current = entriesRef.current.get(serviceDate);
      if (!current) continue;
      const action: AtlasRuntimePendingAction = {
        actionId,
        kind: "task_transition",
        serviceDate,
        taskId: request.taskId,
        transition: request.transition,
        phase: "committing",
      };
      entriesRef.current.set(serviceDate, runtimeEntry({
        canonicalValue: current.canonicalValue,
        pendingActions: [...current.pendingActions, action],
        error: null,
        loading: current.loading,
        requestId: current.requestId,
      }));
    }
    notify();

    let response: AtlasTaskTransitionResponse;
    try {
      response = await commitAtlasTaskTransition(request);
    } catch (error) {
      for (const serviceDate of serviceDates) {
        const failed = entriesRef.current.get(serviceDate);
        if (!failed) continue;
        entriesRef.current.set(serviceDate, runtimeEntry({
          canonicalValue: failed.canonicalValue,
          pendingActions: failed.pendingActions.filter((pending) => pending.actionId !== actionId),
          error: runtimeErrorMessage(error),
          loading: failed.loading,
          requestId: failed.requestId,
        }));
      }
      notify();
      throw error;
    }

    for (const serviceDate of serviceDates) {
      const committed = entriesRef.current.get(serviceDate);
      if (!committed) continue;
      entriesRef.current.set(serviceDate, runtimeEntry({
        canonicalValue: committed.canonicalValue,
        pendingActions: committed.pendingActions.map((pending) => (
          pending.actionId === actionId ? { ...pending, phase: "reconciling" as const } : pending
        )),
        error: null,
        loading: committed.loading,
        requestId: committed.requestId,
      }));
    }
    notify();

    // Reconcile every loaded Worker Day because a canonical task result can also
    // release downstream work, alter carried work, or change more than one date.
    await Promise.allSettled(serviceDates.map((serviceDate) => readWorkerDay(serviceDate, { force: true })));
    return response;
  }, [notify, readWorkerDay]);

  const dispatchClockCommand = useCallback(async (command: AtlasClockCommand) => {
    const current = entriesRef.current.get(command.serviceDate);
    if (!current?.canonicalValue) return commitAtlasClockCommand(command);

    const actionId = `runtime-clock-command:${++actionSequenceRef.current}`;
    const action: AtlasRuntimePendingAction = {
      actionId,
      kind: "clock_command",
      serviceDate: command.serviceDate,
      command,
      phase: "committing",
    };
    entriesRef.current.set(command.serviceDate, runtimeEntry({
      canonicalValue: current.canonicalValue,
      pendingActions: [...current.pendingActions, action],
      error: null,
      loading: current.loading,
      requestId: current.requestId,
    }));
    notify();

    let response: AtlasClockCommandResponse;
    try {
      response = await commitAtlasClockCommand(command);
    } catch (error) {
      const failed = entriesRef.current.get(command.serviceDate);
      if (failed) {
        entriesRef.current.set(command.serviceDate, runtimeEntry({
          canonicalValue: failed.canonicalValue,
          pendingActions: failed.pendingActions.filter((pending) => pending.actionId !== actionId),
          error: runtimeErrorMessage(error),
          loading: failed.loading,
          requestId: failed.requestId,
        }));
        notify();
      }
      throw error;
    }

    const committed = entriesRef.current.get(command.serviceDate);
    if (committed) {
      entriesRef.current.set(command.serviceDate, runtimeEntry({
        canonicalValue: committed.canonicalValue,
        pendingActions: committed.pendingActions.map((pending) => (
          pending.actionId === actionId ? { ...pending, phase: "reconciling" as const } : pending
        )),
        error: null,
        loading: committed.loading,
        requestId: committed.requestId,
      }));
      notify();
    }

    // Clock choreography is service-date scoped. The optimistic placement stays
    // visible until this authoritative projection read confirms the command.
    try {
      await readWorkerDay(command.serviceDate, { force: true });
    } catch {
      // Canonical Clock truth already committed. Keep the reconciling overlay
      // instead of presenting a false rollback when only the follow-up read failed.
    }
    return response;
  }, [notify, readWorkerDay]);

  useEffect(() => registerAtlasRuntimeTaskTransitionHandler(dispatchTaskTransition), [dispatchTaskTransition]);

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
    dispatchClockCommand,
  }), [scopeKey, version, peekWorkerDay, readWorkerDay, invalidateWorkerDay, dispatchTaskTransition, dispatchClockCommand]);

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
  return {
    dispatchTaskTransition: runtime.dispatchTaskTransition,
    dispatchClockCommand: runtime.dispatchClockCommand,
  };
}
