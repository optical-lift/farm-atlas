"use client";

import { usePathname } from "next/navigation";
import GerminationCheckTaskPatch from "./GerminationCheckTaskPatch";

export default function RouteAwareGerminationCheckTaskPatch() {
  const pathname = usePathname();
  const isTaskRoute = pathname === "/task" || pathname.startsWith("/task-focus/");
  if (!isTaskRoute) return null;
  return <GerminationCheckTaskPatch key={pathname} />;
}
