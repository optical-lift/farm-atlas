import type { ReactElement } from "react";
import type { AtlasRegistryZone } from "@/lib/atlas/zone-registry-client";

import type { AtlasFieldLogSeed } from "@/components/atlas/field-log-builder";

declare module "@/components/atlas/field-log-builder" {
  export function FieldLogDrawer(props: {
    zones: AtlasRegistryZone[];
    seed?: AtlasFieldLogSeed;
    onClose: () => void;
    onSaved?: () => void | Promise<void>;
  }): ReactElement;
}
