import Link from "next/link";
import { notFound } from "next/navigation";

import { readOwnerPrincipalDecisionProjection } from "@/lib/atlas/owner-principal-decisions";
import OwnerPrincipalDecisionAction from "../OwnerPrincipalDecisionAction";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

function display(value: string | null, fallback = "Not specified") {
  return value?.trim() || fallback;
}

function windowLabel(value: string | null) {
  if (!value) return "No clock placement claimed by this decision feed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

type Props = {
  params: Promise<{ candidateKey: string }>;
};

export default async function OwnerPrincipalDecisionPage({ params }: Props) {
  const { candidateKey } = await params;
  const projection = await readOwnerPrincipalDecisionProjection();
  const decision = projection.items.find((item) => item.candidateKey === candidateKey);
  if (!decision) notFound();

  const canCommitFlowerDemand =
    decision.commandKind === "flower_demand_commit_to_sale"
    && decision.commandContractVersion === "record_flower_sale_from_demand_core_v1"
    && decision.commandTargetKind === "flower_demand_order"
    && Boolean(decision.commandTargetId)
    && decision.commandTargetId === decision.sourceId
    && Boolean(decision.linkedFarmId);

  return (
    <main className={styles.root} data-atlas-principal-decision="true">
      <div className={styles.page}>
        <header className={styles.chrome}>
          <Link href="/owner">← Today</Link>
          <span>Principal decision · production truth</span>
        </header>

        <article className={styles.sheet}>
          <small>{decision.portfolioUnitName}</small>
          <h1>{decision.title}</h1>
          <p className={styles.prompt}>{decision.prompt}</p>

          <dl className={styles.facts}>
            <div>
              <dt>Why it reached you</dt>
              <dd>{display(decision.reasonForFloor, "An explicit Principal admission was recorded for this source.")}</dd>
            </div>
            <div>
              <dt>Admission basis</dt>
              <dd>{display(decision.admissionBasis)}</dd>
            </div>
            <div>
              <dt>Consequence of waiting</dt>
              <dd>{display(decision.consequence)}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>{display(decision.authorityBasis, "Principal authority established by the decision membrane")}</dd>
            </div>
            <div>
              <dt>Decision window</dt>
              <dd>{windowLabel(decision.windowEnd)}</dd>
            </div>
            <div>
              <dt>Expected attention</dt>
              <dd>{decision.expectedPrincipalMinutes === null ? "Not specified" : `${decision.expectedPrincipalMinutes} minute${decision.expectedPrincipalMinutes === 1 ? "" : "s"}`}</dd>
            </div>
            <div>
              <dt>Canonical source</dt>
              <dd>{display(decision.sourceDomain)} · {display(decision.sourceKind)} · {display(decision.sourceId)}</dd>
            </div>
            {canCommitFlowerDemand ? (
              <div>
                <dt>Current truth</dt>
                <dd>Demand is committed, priced, and fully reserved. No active Sale currently resolves this transition.</dd>
              </div>
            ) : null}
          </dl>

          <p className={styles.boundary}>
            This sheet is a projection of canonical operational truth. Opening it does not create a Sale, fulfillment event, payment, or Clock placement.
          </p>

          {canCommitFlowerDemand && decision.linkedFarmId && decision.commandTargetId ? (
            <OwnerPrincipalDecisionAction
              candidateKey={decision.candidateKey}
              farmId={decision.linkedFarmId}
              demandOrderId={decision.commandTargetId}
            />
          ) : (
            <p className={styles.readOnly}>This decision has no application-owned executable command on the Owner surface yet.</p>
          )}
        </article>
      </div>
    </main>
  );
}
