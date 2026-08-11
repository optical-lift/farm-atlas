import type { ReactNode } from "react";

import DayTaskOpenBridge from "./DayTaskOpenBridge";

export default function DayLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <DayTaskOpenBridge />
    </>
  );
}
