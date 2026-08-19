import WorkerTaskBlockedState from "@/components/atlas/worker-task-blocked-state";
import type { WorkerTaskBlockedPresentation } from "@/lib/atlas/worker-task-readiness";

const presentation: WorkerTaskBlockedPresentation = {
  blocked: true,
  reasonKind: "resource",
  heading: "Not ready to start yet",
  reason: "The equipment or supply this work needs isn’t ready yet.",
  nextStep: "You don’t need to do anything with this task right now. Atlas will bring it back when it’s ready.",
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
