import type {
  AtlasTaskTransitionRequest,
  AtlasTaskTransitionResponse,
} from "@/lib/atlas/task-transition-client";

type AtlasRuntimeTaskTransitionHandler = (
  input: AtlasTaskTransitionRequest,
) => Promise<AtlasTaskTransitionResponse>;

let taskTransitionHandler: AtlasRuntimeTaskTransitionHandler | null = null;

export function registerAtlasRuntimeTaskTransitionHandler(handler: AtlasRuntimeTaskTransitionHandler) {
  taskTransitionHandler = handler;
  return () => {
    if (taskTransitionHandler === handler) taskTransitionHandler = null;
  };
}

export function readAtlasRuntimeTaskTransitionHandler() {
  return taskTransitionHandler;
}
