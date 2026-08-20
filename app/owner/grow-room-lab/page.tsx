import type { Metadata } from "next";

import GrowRoomBoardSpecimen from "./GrowRoomBoardSpecimen";

export const metadata: Metadata = {
  title: "Grow Room Board Lab · Atlas",
};

export default function GrowRoomLabPage() {
  return <GrowRoomBoardSpecimen />;
}
