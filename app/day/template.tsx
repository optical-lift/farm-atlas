"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export default function DayRouteTemplate({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  return <div key={searchParams.toString()}>{children}</div>;
}
