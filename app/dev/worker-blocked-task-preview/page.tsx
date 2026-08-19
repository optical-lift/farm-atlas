import WorkerTaskBlockedState from "@/components/atlas/worker-task-blocked-state";
import type { WorkerTaskBlockedPresentation } from "@/lib/atlas/worker-task-readiness";

const presentation: WorkerTaskBlockedPresentation = {
  blocked: true,
  reasonKind: "resource",
  heading: "Not ready to start yet",
  reason: "This job is waiting on equipment.",
  nextStep: "Nothing you need to do here right now. Atlas will bring it back when it’s ready.",
};

export default function WorkerBlockedTaskPreviewPage() {
  return (
    <WorkerTaskBlockedState
      title="Mowing — Mow Corral"
      location="Corral"
      returnHref="#"
      presentation={presentation}
    />
  );
}
