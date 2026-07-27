import { NextResponse } from "next/server";

import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

type ProjectTaskDestination = {
  taskId: string;
  projectId: string;
  projectTitle: string;
};

export async function GET(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) {
    return NextResponse.json({ ok: false, error: "A valid task is required." }, { status: 400 });
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("project_task_destination_v1", {
    p_task_id: taskId,
  });

  if (error) {
    const denied = error.code === "42501";
    return NextResponse.json(
      { ok: false, error: denied ? "Project task access is not active." : "Project task destination failed." },
      { status: denied ? 403 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    destination: (data as ProjectTaskDestination | null) ?? null,
  });
}
