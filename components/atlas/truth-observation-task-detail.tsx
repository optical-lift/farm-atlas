import AtlasInputRenderer from "@/components/atlas/input/AtlasInputRenderer";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  createCanonicalWorkerTruthObservationContract,
  isCanonicalWorkerTruthObservationTask,
} from "@/lib/atlas/input-contracts/worker-truth-observation";

export { isCanonicalWorkerTruthObservationTask };

export default function TruthObservationTaskDetail({
  task,
  assignee,
}: {
  task: AtlasTaskCard;
  assignee: AtlasAssigneeConfig;
}) {
  const contract = createCanonicalWorkerTruthObservationContract(task);

  return (
    <AtlasInputRenderer
      contract={contract}
      returnHref={assignee.listPath}
      returnLabel="work"
      recordLabel="record"
      submission={{
        endpoint: "/api/atlas/truth-observation-result",
        body: { taskId: task.task_id },
      }}
    />
  );
}
