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
  readAtlasWorkerDayProjection,
  type AtlasWorkerDayProjectionRead,
} from "@/lib/atlas/worker-day-projection-client";

type WorkerDayRuntimeEntry = {
  value: AtlasWorkerDayProjectionRead | null;
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
};

const AtlasRuntimeContext = createContext<AtlasRuntimeContextValue | null>(null);

function runtimeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Atlas could not load the worker Day projection.";
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
    entriesRef.current.set(dateIso, {
      value: cached?.value ?? null,
      error: null,
      loading: true,
      requestId,
    });
    notify();

    const request = readAtlasWorkerDayProjection(dateIso)
      .then((value) => {
        const current = entriesRef.current.get(dateIso);
        if (current?.requestId === requestId) {
          entriesRef.current.set(dateIso, { value, error: null, loading: false, requestId });
          notify();
        }
        return value;
      })
      .catch((error) => {
        const current = entriesRef.current.get(dateIso);
        if (current?.requestId === requestId) {
          entriesRef.current.set(dateIso, {
            value: current.value,
            error: runtimeErrorMessage(error),
            loading: false,
            requestId,
          });
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
  }), [scopeKey, version, peekWorkerDay, readWorkerDay, invalidateWorkerDay]);

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
    reload,
    runtimeScopeKey: runtime.scopeKey,
  };
}
