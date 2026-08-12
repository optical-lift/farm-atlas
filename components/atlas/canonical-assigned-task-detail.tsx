import CanonicalAssignedTaskDetailClient, {
  type CanonicalAssignedTaskDetailClientProps,
} from "@/components/atlas/canonical-assigned-task-detail-client";
import { workerExecutionTaskCard, workerExecutionTaskCards } from "@/lib/atlas/worker-execution-contract";

/**
 * Server boundary for ordinary assigned-task execution.
 *
 * Anna's Task Focus is a worker execution surface. Sanitize the task and child
 * cards before they cross the Server Component -> Client Component boundary so
 * Owner strategy never reaches the Farm Hand browser payload by accident.
 */
export default function CanonicalAssignedTaskDetail(props: CanonicalAssignedTaskDetailClientProps) {
  if (props.assignee.key !== "anna") {
    return <CanonicalAssignedTaskDetailClient {...props} />;
  }

  return (
    <CanonicalAssignedTaskDetailClient
      {...props}
      task={workerExecutionTaskCard(props.task)}
      childTasks={workerExecutionTaskCards(props.childTasks)}
    />
  );
}
