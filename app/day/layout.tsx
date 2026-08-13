import type { ReactNode } from "react";

import "./worker-day-detail.css";
import DayCueDelivery from "./DayCueDelivery";
import DaySurface from "./DaySurface";

export default function DayLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DaySurface>{children}</DaySurface>
      <DayCueDelivery />
    </>
  );
}
