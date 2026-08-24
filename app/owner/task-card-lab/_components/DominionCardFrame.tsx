import type { ReactNode } from "react";

import AtlasTaskCardFrame, { type AtlasTaskCardFrameProps } from "@/components/atlas/task-card-frame";

type DominionCardFrameBaseProps = Pick<
  AtlasTaskCardFrameProps,
  "family" | "title" | "subtitle" | "familyDetail" | "timing" | "children" | "className"
>;

export type DominionCardFrameProps = DominionCardFrameBaseProps & {
  completion?: Exclude<ReactNode, undefined>;
};

export default function DominionCardFrame({ completion, ...props }: DominionCardFrameProps) {
  if (completion !== undefined) {
    return <AtlasTaskCardFrame {...props} completion={completion} />;
  }

  return <AtlasTaskCardFrame {...props} completionPreview />;
}
