import { notFound } from "next/navigation";

import { isValidAtlasTaskId } from "@/lib/atlas/task-routing-core.js";
import "./network-outreach-cleanup.css";
import "./steps-always-visible.css";

export const dynamic = "force-dynamic";

export default async function TaskFocusLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ taskId: string }> }>) {
  const { taskId } = await params;
  if (!isValidAtlasTaskId(taskId)) notFound();
  return <>{children}</>;
}
