import type { Metadata } from "next";

import ClockDayLab from "./ClockDayLab";
import UnlockMoveStudies from "./UnlockMoveStudies";

export const metadata: Metadata = {
  title: "Clock + Day Lab · Atlas",
};

export default function ClockDayLabPage() {
  return (
    <>
      <div style={{ padding: "28px 18px 0", background: "#ece9e1" }}>
        <UnlockMoveStudies />
      </div>
      <ClockDayLab />
    </>
  );
}
