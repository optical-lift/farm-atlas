import Link from "next/link";
import { redirect } from "next/navigation";

import { getAtlasSession } from "@/lib/atlas/session";
import { atlasViewerFromSession } from "@/lib/atlas/viewer";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type GrowRoomSearchParams = Record<string, string | string[] | undefined>;

type GrowRoomRoundRead = {
  visitTask?: {
    taskId?: string | null;
    dueDate?: string | null;
  } | null;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function taskFocusHref(taskId: string, returnTo: string | null) {
  const params = new URLSearchParams();
  if (returnTo) params.set("returnTo", returnTo);
  const query = params.toString();
  return `/task-focus/${encodeURIComponent(taskId)}${query ? `?${query}` : ""}`;
}

export default async function GrowRoomPage({
  searchParams,
}: {
  searchParams?: Promise<GrowRoomSearchParams>;
}) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const viewer = atlasViewerFromSession(session);
  if (!viewer) redirect("/auth/error?reason=farm_membership_required");

  const params = searchParams ? await searchParams : {};
  const requestedTaskId = firstParam(params.visitTaskId)?.trim() || null;
  const returnTo = safeReturnTo(firstParam(params.returnTo)) || "/";
  if (requestedTaskId) redirect(taskFocusHref(requestedTaskId, returnTo));

  const supabase = await createAtlasServerClient();
  const { data } = await supabase.rpc("grow_room_round_v1", {
    p_farm_id: viewer.farmId,
    p_visit_task_id: null,
  });
  const round = data as GrowRoomRoundRead | null;
  const currentTaskId = round?.visitTask?.taskId?.trim() || null;
  const currentReturnTo = round?.visitTask?.dueDate
    ? `/day?date=${encodeURIComponent(round.visitTask.dueDate)}`
    : returnTo;

  if (currentTaskId) redirect(taskFocusHref(currentTaskId, currentReturnTo));

  return (
    <main className="atlas-task-page-shell">
      <article className="atlas-task-page-phone">
        <header className="atlas-phone-top">
          <Link href="/" className="atlas-task-header-brand atlas-phone-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <strong className="atlas-phone-title">Elm Farm</strong>
          </Link>
        </header>
        <div className="atlas-task-page-body">
          <section className="atlas-task-page-active atlas-dominion-task-card">
            <section className="atlas-task-dominion-move">
              <small className="atlas-soft-label">No task released</small>
              <h1>There is no current Grow Room Care task.</h1>
              <Link href="/">Return to Today</Link>
            </section>
          </section>
        </div>
      </article>
    </main>
  );
}
