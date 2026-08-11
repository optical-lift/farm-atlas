import type { ReactNode } from "react";

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
