import Link from "next/link";
import { redirect } from "next/navigation";

import { readAtlasProjectPullSelector } from "@/lib/atlas/project-pull";
import { createAtlasServerClient } from "@/lib/supabase/server";
import styles from "./ProjectPull.module.css";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function selectorHref(projectId: string, membershipId: string, error?: string) {
  const params = new URLSearchParams({ membershipId, returnTo: "/" });
  if (error) params.set("error", error);
  return `/project-pull/${encodeURIComponent(projectId)}?${params.toString()}`;
}

async function pullProjectItem(formData: FormData) {
  "use server";

  const projectId = safeText(formData.get("projectId"));
  const projectItemId = safeText(formData.get("projectItemId"));
  const membershipId = safeText(formData.get("membershipId"));
  const serviceDate = safeText(formData.get("serviceDate"));

  if (!projectId || !projectItemId || !membershipId || !serviceDate) {
    redirect(selectorHref(projectId || "missing", membershipId || "missing", "That project choice was incomplete. Please try again."));
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("pull_project_item_to_today_v1", {
    p_project_item_id: projectItemId,
    p_membership_id: membershipId,
    p_day: serviceDate,
    p_note: "Chosen as the next Finish Project serving for the paid workday.",
  });

  if (error) {
    redirect(selectorHref(projectId, membershipId, error.message));
  }

  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const taskId = safeText(payload.taskId);
  if (!taskId) {
    redirect(selectorHref(projectId, membershipId, "Atlas created the choice but did not return its task. Please reopen today."));
  }

  redirect(`/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent("/")}`);
}

export default async function ProjectPullPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const membershipId = firstValue(query.membershipId) ?? "";
  const errorMessage = firstValue(query.error) ?? "";

  if (!projectId || !membershipId) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <Link className={styles.back} href="/">← Today</Link>
          <div className={styles.empty}>Atlas could not tell which Daily Hand this project choice belongs to.</div>
        </div>
      </main>
    );
  }

  let selector;
  try {
    selector = await readAtlasProjectPullSelector(projectId, membershipId, new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()));
  } catch (error) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <Link className={styles.back} href="/">← Today</Link>
          <div className={styles.empty}>{error instanceof Error ? error.message : "Atlas could not open this project pool."}</div>
        </div>
      </main>
    );
  }

  const { status, options } = selector;
  const fittingOptions = options.options.filter((option) => option.fitsToday);
  const notFittingOptions = options.options.filter((option) => !option.fitsToday);
  const projectMinutes = Math.min(status.remainingPullMinutes, options.capacity.projectPullBudgetMinutes);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href="/">← Today</Link>
        <p className={styles.eyebrow}>Today’s paid workday · Physical progress</p>
        <h1 className={styles.title}>Choose the next finish card.</h1>
        <p className={styles.intro}>
          Choose the next workable serving. Atlas can use several Finish Project jobs to fill the paid workday, but only one actionable project serving needs to be in hand at a time. Unchosen work stays undated in the durable project pool.
        </p>

        <div className={styles.budget}>
          <span className={styles.pill}>{projectMinutes} min paid-work capacity remains</span>
          <span className={styles.pill}>{options.capacity.alreadyPresentedRegularMinutes} min already committed</span>
          <span className={styles.pill}>{status.availableItemCount} finish cards still in the pool</span>
        </div>

        {errorMessage ? <div className={styles.error}>{errorMessage}</div> : null}

        {status.completeForToday ? (
          <div className={styles.empty}>
            Atlas does not need another Finish Project serving right now: the paid-work target is filled or no eligible project work remains.
          </div>
        ) : fittingOptions.length ? (
          <div className={styles.cards}>
            {fittingOptions.map((option) => (
              <article className={styles.card} key={option.projectItemId}>
                <div className={styles.cardTop}>
                  <h2 className={styles.cardTitle}>{option.title}</h2>
                  <span className={styles.minutes}>{option.expectedActiveMinutes} min</span>
                </div>
                <p className={styles.meta}>
                  {[option.location, option.environment, option.physicalLoad].filter(Boolean).join(" · ")}
                </p>
                {option.note ? <p className={styles.note}>{option.note}</p> : null}
                <form action={pullProjectItem}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="projectItemId" value={option.projectItemId} />
                  <input type="hidden" name="membershipId" value={membershipId} />
                  <input type="hidden" name="serviceDate" value={status.serviceDate} />
                  <button className={styles.choose} type="submit">Take this one next</button>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            Nothing in this project fits the paid capacity still available today. The remaining project work stays in the reservoir without being pushed to tomorrow.
          </div>
        )}

        {notFittingOptions.length && !status.completeForToday ? (
          <p className={styles.quiet}>
            Atlas kept {notFittingOptions.length} additional ready {notFittingOptions.length === 1 ? "card" : "cards"} out of the choices above because they do not fit the remaining paid-work or physical-load capacity today.
          </p>
        ) : null}
      </div>
    </main>
  );
}
