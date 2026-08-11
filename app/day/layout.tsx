import type { ReactNode } from "react";

import DayCueDelivery from "./DayCueDelivery";
import DayTaskOpenBridge from "./DayTaskOpenBridge";

export default function DayLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <DayTaskOpenBridge />
      <DayCueDelivery />
    </>
  );
}
