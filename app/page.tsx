import AtlasHomePortal from "@/components/atlas/home/AtlasHomePortal";
import { requireAtlasViewer } from "@/lib/atlas/viewer-context";

export const dynamic = "force-dynamic";

export default async function AtlasHomePage() {
  const viewer = await requireAtlasViewer();
  return <AtlasHomePortal viewer={viewer} />;
}
