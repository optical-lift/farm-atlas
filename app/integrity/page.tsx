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

type IntegrityIssue = {
  issue_key: string;
  severity: "critical" | "warning" | string;
  entity_type: string;
  issue_count: NumericValue;
};

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
  active_tasks_with_scope: NumericValue;
  field_logs: NumericValue;
  field_logs_with_object: NumericValue;
  field_logs_with_scope: NumericValue;
  growing_objects: NumericValue;
  objects_with_contents: NumericValue;
  legacy_content_rows: NumericValue;
  legacy_content_with_identity: NumericValue;
  canonical_crop_cycles: NumericValue;
  planting_claims: NumericValue;
  planting_claims_with_object: NumericValue;
  semantic_duplicate_content_groups: NumericValue;
  generated_task_collision_groups: NumericValue;
  resources: NumericValue;
  task_resource_links: NumericValue;
  tasks_with_resource_requirements: NumericValue;
  truth_sources: NumericValue;
  truth_assertions: NumericValue;
  issue_summary: unknown;
  sources: unknown;
  baseline_captured_at: string | null;
};

const ISSUE_LABELS: Record<string, string> = {
  active_task_without_object: "Active tasks without object links",
  active_task_without_scope: "Active tasks without any scope",
  field_log_without_object: "Field logs without object links",
  field_log_without_scope: "Field logs without any scope",
  legacy_content_without_identity: "Legacy content without crop or claim identity",
  planting_claim_without_object: "Planting claims without object links",
  semantic_duplicate_content_group: "Duplicate content groups",
  generated_task_collision_group: "Generated task collision groups",
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
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("v_integrity_report")
    .select("*")
    .eq("farm_key", "elm_farm")
    .single();

  if (error || !data) {
    return <ErrorState />;
  }

  const report = data as IntegrityReport;
  const issues = Array.isArray(report.issue_summary)
    ? (report.issue_summary as IntegrityIssue[])
    : [];
  const sources = Array.isArray(report.sources)
    ? (report.sources as IntegritySource[])
    : [];

  const taskLinkRate = percent(report.active_tasks_with_object, report.active_tasks);
  const logLinkRate = percent(report.field_logs_with_object, report.field_logs);
  const objectContentRate = percent(report.objects_with_contents, report.growing_objects);
  const contentIdentityRate = percent(
    report.legacy_content_with_identity,
    report.legacy_content_rows,
  );
  const claimLinkRate = percent(
    report.planting_claims_with_object,
    report.planting_claims,
  );

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Atlas · Elm Farm</p>
            <h1>Integrity</h1>
            <p className={styles.subtitle}>Phase 1 · read-only audit</p>
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
            <p className={styles.heroLabel}>Source of truth</p>
            <h2>Supabase is the farm record.</h2>
            <p>Existing records are preserved. The legacy browser writer is frozen.</p>
          </div>
          <span>Phase 1</span>
        </section>

        <section className={styles.controlGrid} aria-label="Phase 1 controls">
          <article>
            <span>Database</span>
            <strong>Supabase only</strong>
          </article>
          <article>
            <span>Legacy /field writer</span>
            <strong>Frozen</strong>
          </article>
          <article>
            <span>Cleanup</span>
            <strong>Not started</strong>
          </article>
          <article>
            <span>Baseline</span>
            <strong>{formatBaseline(report.baseline_captured_at)}</strong>
          </article>
        </section>

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Live linkage</p>
              <h2>Farm state</h2>
            </div>
            <span>Supabase</span>
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
              label="Canonical crop cycles"
              value={String(numberOf(report.canonical_crop_cycles))}
              detail="normalized lifecycle records"
            />
          </div>
        </section>

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Baseline backlog</p>
              <h2>Identity and relationships</h2>
            </div>
            <span>Before cleanup</span>
          </header>

          <div className={styles.metricGrid}>
            <MetricCard
              label="Legacy content with identity"
              value={`${numberOf(report.legacy_content_with_identity)} / ${numberOf(report.legacy_content_rows)}`}
              detail={`${contentIdentityRate}% linked to a crop profile or planting claim`}
              progress={contentIdentityRate}
            />
            <MetricCard
              label="Scoped planting claims"
              value={`${numberOf(report.planting_claims_with_object)} / ${numberOf(report.planting_claims)}`}
              detail={`${claimLinkRate}% linked`}
              progress={claimLinkRate}
            />
            <MetricCard
              label="Duplicate content groups"
              value={String(numberOf(report.semantic_duplicate_content_groups))}
              detail="review groups; none merged"
            />
            <MetricCard
              label="Generated task collisions"
              value={String(numberOf(report.generated_task_collision_groups))}
              detail="active collision groups"
            />
            <MetricCard
              label="Resource catalog"
              value={String(numberOf(report.resources))}
              detail={`${numberOf(report.task_resource_links)} task links across ${numberOf(report.tasks_with_resource_requirements)} tasks`}
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
              <p className={styles.eyebrow}>Integrity queue</p>
              <h2>Relationship gaps</h2>
            </div>
            <span>{issues.length} types</span>
          </header>

          <div className={styles.issueList}>
            {issues.map((issue) => (
              <article
                className={`${styles.issueRow} ${
                  issue.severity === "critical" ? styles.critical : styles.warning
                }`}
                key={issue.issue_key}
              >
                <strong>{numberOf(issue.issue_count)}</strong>
                <div>
                  <p>{ISSUE_LABELS[issue.issue_key] ?? issue.issue_key}</p>
                  <span>{issue.entity_type.replaceAll("_", " ")}</span>
                </div>
                <i>{issue.severity}</i>
              </article>
            ))}
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
          <p>Phase 1 is read-only. No existing records were deleted or merged.</p>
          <Link href="/zones">Open the object registry</Link>
        </footer>
      </section>
    </main>
  );
}
