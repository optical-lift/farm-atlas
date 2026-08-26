import type { Metadata } from "next";

import ClockDayLab from "./ClockDayLab";

export const metadata: Metadata = {
  title: "Clock + Day Lab · Atlas",
};

export default function ClockDayLabPage() {
  return <ClockDayLab />;
}
