import type { Metadata } from "next";
import Link from "next/link";

import { atlasSupabase } from "@/lib/atlas/supabase-server";

import styles from "./integrity.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atlas Integrity | Elm Farm",
  robots: {
    index: false,
    follow: false,
  },
};

type NumericValue = number | string | null;

type IntegritySource = {
  stable_key: string;
  label: string;
  source_type: string;
  source_date: string | null;
  authority_rank: NumericValue;
};

type IntegrityReport = {
  active_tasks: NumericValue;
  active_tasks_with_object: NumericValue;
  field_logs: NumericValue;
  field_logs_with_object: NumericValue;
  growing_objects: NumericValue;
  objects_with_contents: NumericValue;
  planting_claims: NumericValue;
  planting_claims_with_object: NumericValue;
  generated_task_collision_groups: NumericValue;
  truth_sources: NumericValue;
  truth_assertions: NumericValue;
  sources: unknown;
  baseline_captured_at: string | null;
};

type GraphSummary = {
  farm_id: string;
  legacy_content_rows: NumericValue;
  resolved_content_rows: NumericValue;
  resolution_coverage_percent: NumericValue;
  active_crop_cycles: NumericValue;
  current_plant_instances: NumericValue;
  duplicate_rows_mapped: NumericValue;
  open_reviews: NumericValue;
  current_entities_without_object: NumericValue;
  unlinked_planting_claims: NumericValue;
  unprofiled_crop_cycles: NumericValue;
};

type ReviewItem = {
  review_key: string;
  entity_type: string;
  issue_type: string;
  priority: string;
  candidate_data: unknown;
};

function numberOf(value: NumericValue) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function percent(part: NumericValue, total: NumericValue) {
  const denominator = numberOf(total);
  if (!denominator) return 0;
  return Math.round((numberOf(part) / denominator) * 100);
}

function formatBaseline(value: string | null) {
  if (!value) return "Not captured";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(new Date(value));
}

function reviewLabel(item: ReviewItem) {
  if (!item.candidate_data || typeof item.candidate_data !== "object") {
    return item.entity_type.replaceAll("_", " ");
  }

  const candidate = item.candidate_data as Record<string, unknown>;
  const value = candidate.content_label ?? candidate.crop_label ?? candidate.variety;
  return typeof value === "string" ? value : item.entity_type.replaceAll("_", " ");
}

function MetricCard({
  label,
  value,
  detail,
  progress,
}: {
  label: string;
  value: string;
  detail: string;
  progress?: number;
}) {
  return (
    <article className={styles.metricCard}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
      {typeof progress === "number" ? (
        <progress
          className={styles.progressTrack}
          aria-label={`${label}: ${progress}%`}
          max={100}
          value={Math.max(0, Math.min(progress, 100))}
        />
      ) : null}
    </article>
  );
}

function ErrorState() {
  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Atlas · Elm Farm</p>
            <h1>Integrity</h1>
          </div>
          <Link className={styles.navLink} href="/">
            Home
          </Link>
        </header>
        <section className={styles.errorCard}>
          <h2>The integrity report could not load.</h2>
          <p>The farm data was not changed. Try this page again after the current deployment finishes.</p>
        </section>
      </section>
    </main>
  );
}

export default async function AtlasIntegrityPage() {
  const [integrityResult, graphResult] = await Promise.all([
    atlasSupabase
      .schema("atlas")
      .from("v_integrity_report")
      .select("*")
      .eq("farm_key", "elm_farm")
      .single(),
    atlasSupabase
      .schema("atlas")
      .from("v_phase_2_graph_summary")
      .select("*")
      .eq("farm_key", "elm_farm")
      .single(),
  ]);

  if (
    integrityResult.error ||
    graphResult.error ||
    !integrityResult.data ||
    !graphResult.data
  ) {
    console.error("[atlas-integrity] report query failed", {
      integrityError: integrityResult.error?.message,
      graphError: graphResult.error?.message,
      hasIntegrityData: Boolean(integrityResult.data),
      hasGraphData: Boolean(graphResult.data),
    });
    return <ErrorState />;
  }

  const report = integrityResult.data as IntegrityReport;
  const graph = graphResult.data as GraphSummary;
  const { data: reviewData, error: reviewError } = await atlasSupabase
    .schema("atlas")
    .from("identity_review_queue")
    .select("review_key, entity_type, issue_type, priority, candidate_data")
    .eq("farm_id", graph.farm_id)
    .eq("status", "open")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (reviewError) {
    console.error("[atlas-integrity] review queue query failed", {
      code: reviewError.code,
      message: reviewError.message,
    });
  }

  const reviews = (reviewData ?? []) as ReviewItem[];
  const sources = Array.isArray(report.sources)
    ? (report.sources as IntegritySource[])
    : [];

  const sourceCoverage = numberOf(graph.resolution_coverage_percent);
  const taskLinkRate = percent(report.active_tasks_with_object, report.active_tasks);
  const logLinkRate = percent(report.field_logs_with_object, report.field_logs);
  const objectContentRate = percent(report.objects_with_contents, report.growing_objects);
  const claimLinkRate = percent(report.planting_claims_with_object, report.planting_claims);
  const currentEntityCount =
    numberOf(graph.active_crop_cycles) + numberOf(graph.current_plant_instances);

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Atlas · Elm Farm</p>
            <h1>Integrity</h1>
            <p className={styles.subtitle}>Phase 2 · canonical farm graph</p>
          </div>
          <nav className={styles.nav} aria-label="Integrity navigation">
            <Link className={styles.navLink} href="/zones">
              Zones
            </Link>
            <Link className={styles.navLink} href="/">
              Home
            </Link>
          </nav>
        </header>

        <section className={styles.hero}>
          <div>
            <p className={styles.heroLabel}>Canonical farm graph</p>
            <h2>Every farm thing has one address.</h2>
            <p>
              Crops and permanent plants now point to physical objects. Source observations
              remain intact, and uncertain records wait for a real decision.
            </p>
          </div>
          <span>Phase 2</span>
        </section>

        <section className={styles.controlGrid} aria-label="Phase 2 controls">
          <article>
            <span>Legacy source rows</span>
            <strong>{numberOf(graph.legacy_content_rows)} preserved</strong>
          </article>
          <article>
            <span>Current entities</span>
            <strong>{currentEntityCount} addressed</strong>
          </article>
          <article>
            <span>Review queue</span>
            <strong>{numberOf(graph.open_reviews)} explicit decisions</strong>
          </article>
          <article>
            <span>Phase 1 baseline</span>
            <strong>{formatBaseline(report.baseline_captured_at)}</strong>
          </article>
        </section>

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>One identity per real thing</p>
              <h2>Canonical graph</h2>
            </div>
            <span>Supabase</span>
          </header>

          <div className={styles.metricGrid}>
            <MetricCard
              label="Source rows resolved"
              value={`${numberOf(graph.resolved_content_rows)} / ${numberOf(graph.legacy_content_rows)}`}
              detail={`${sourceCoverage}% mapped without deletion`}
              progress={sourceCoverage}
            />
            <MetricCard
              label="Active crop cycles"
              value={String(numberOf(graph.active_crop_cycles))}
              detail="annual and current crop identities"
            />
            <MetricCard
              label="Permanent plant instances"
              value={String(numberOf(graph.current_plant_instances))}
              detail="perennials, dahlias, herbs, and volunteers"
            />
            <MetricCard
              label="Redundant revisions mapped"
              value={String(numberOf(graph.duplicate_rows_mapped))}
              detail="source rows retained as supporting evidence"
            />
            <MetricCard
              label="Current things without place"
              value={String(numberOf(graph.current_entities_without_object))}
              detail="must remain zero"
            />
            <MetricCard
              label="Generated task collisions"
              value={String(numberOf(report.generated_task_collision_groups))}
              detail="database guardrail now blocks new collisions"
            />
          </div>
        </section>

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>No invented answers</p>
              <h2>Needs a human decision</h2>
            </div>
            <span>{reviews.length} open</span>
          </header>

          <div className={styles.issueList}>
            {reviews.map((review) => (
              <article
                className={`${styles.issueRow} ${
                  review.priority === "high" ? styles.critical : styles.warning
                }`}
                key={review.review_key}
              >
                <strong>?</strong>
                <div>
                  <p>{reviewLabel(review)}</p>
                  <span>{review.issue_type.replaceAll("_", " ")}</span>
                </div>
                <i>{review.priority}</i>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Operational linkage</p>
              <h2>Records attached to place</h2>
            </div>
            <span>Live</span>
          </header>

          <div className={styles.metricGrid}>
            <MetricCard
              label="Object-linked active tasks"
              value={`${numberOf(report.active_tasks_with_object)} / ${numberOf(report.active_tasks)}`}
              detail={`${taskLinkRate}% linked`}
              progress={taskLinkRate}
            />
            <MetricCard
              label="Object-linked field logs"
              value={`${numberOf(report.field_logs_with_object)} / ${numberOf(report.field_logs)}`}
              detail={`${logLinkRate}% linked`}
              progress={logLinkRate}
            />
            <MetricCard
              label="Objects with crop content"
              value={`${numberOf(report.objects_with_contents)} / ${numberOf(report.growing_objects)}`}
              detail={`${objectContentRate}% populated`}
              progress={objectContentRate}
            />
            <MetricCard
              label="Scoped planting claims"
              value={`${numberOf(report.planting_claims_with_object)} / ${numberOf(report.planting_claims)}`}
              detail={`${claimLinkRate}% linked; ${numberOf(graph.unlinked_planting_claims)} queued`}
              progress={claimLinkRate}
            />
            <MetricCard
              label="Crop profiles still unknown"
              value={String(numberOf(graph.unprofiled_crop_cycles))}
              detail="left unknown instead of guessed"
            />
            <MetricCard
              label="Provenance"
              value={String(numberOf(report.truth_assertions))}
              detail={`${numberOf(report.truth_sources)} registered sources`}
            />
          </div>
        </section>

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Provenance registry</p>
              <h2>Registered sources</h2>
            </div>
            <span>{sources.length} sources</span>
          </header>

          <div className={styles.sourceList}>
            {sources.map((source) => (
              <article key={source.stable_key}>
                <div>
                  <strong>{source.label}</strong>
                  <span>{source.source_type}</span>
                </div>
                <b>{numberOf(source.authority_rank)}</b>
              </article>
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          <p>Phase 2 preserves every source row. No destructive cleanup and no invented farm state.</p>
          <Link href="/zones">Open the object registry</Link>
        </footer>
      </section>
    </main>
  );
}
