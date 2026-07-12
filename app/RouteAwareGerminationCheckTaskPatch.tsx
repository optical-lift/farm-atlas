"use client";

import { usePathname } from "next/navigation";
import GerminationCheckTaskPatch from "./GerminationCheckTaskPatch";

export default function RouteAwareGerminationCheckTaskPatch() {
  const pathname = usePathname();
  if (pathname !== "/task") return null;
  return <GerminationCheckTaskPatch key={pathname} />;
}
