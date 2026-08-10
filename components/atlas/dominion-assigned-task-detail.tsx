"use client";

import AssignedTaskExecutionShell, {
  type AssignedTaskExecutionShellProps,
} from "@/components/atlas/assigned-task-execution-shell";

/**
 * Compatibility boundary for specialized task routes that still import the old
 * Dominion detail name. The worker execution architecture now lives entirely in
 * AssignedTaskExecutionShell; Pass 6 can migrate these callers one domain at a time.
 */
export default function DominionAssignedTaskDetail(props: AssignedTaskExecutionShellProps) {
  return <AssignedTaskExecutionShell {...props} />;
}
