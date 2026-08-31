export const REPORT_STATEMENT_TYPES = [
  "completed_action",
  "in_progress_action",
  "intention",
  "observation",
  "recommendation",
] as const;

export const REPORT_EVIDENCE_MATCHES = [
  "match_open",
  "match_done",
  "no_match",
  "uncertain",
] as const;

export const REPORT_OWNER_ATTENTION = ["none", "fyi", "decision_required"] as const;

export type ReportStatementType = (typeof REPORT_STATEMENT_TYPES)[number];
export type ReportEvidenceMatch = (typeof REPORT_EVIDENCE_MATCHES)[number];
export type ReportOwnerAttention = (typeof REPORT_OWNER_ATTENTION)[number];

export type RawReportClaim = {
  id: string;
  text: string;
  statementType: ReportStatementType;
  subject: string | null;
  evidenceIds: string[];
  evidenceMatch: ReportEvidenceMatch;
  ownerAttention: ReportOwnerAttention;
  note: string;
};

export type ReconciliationClassification =
  | "already_recorded"
  | "possible_stale_record"
  | "possible_unrepresented_work"
  | "in_progress_report"
  | "intention_only"
  | "observation_only"
  | "recommendation_only"
  | "ambiguous";

export type GovernedReportClaim = RawReportClaim & {
  sourceLabel: string;
  sourceAuthority: "reporting_only";
  permittedStateEffect: "append_source_attributed_evidence_only";
  governingStateChanged: false;
  classification: ReconciliationClassification;
};

function classificationFor(claim: RawReportClaim): ReconciliationClassification {
  if (claim.statementType === "recommendation") return "recommendation_only";
  if (claim.statementType === "observation") return "observation_only";
  if (claim.statementType === "intention") return "intention_only";
  if (claim.statementType === "in_progress_action") return "in_progress_report";

  if (claim.evidenceMatch === "match_done") return "already_recorded";
  if (claim.evidenceMatch === "match_open") return "possible_stale_record";
  if (claim.evidenceMatch === "no_match") return "possible_unrepresented_work";
  return "ambiguous";
}

/**
 * Noel runtime boundary for attributed worker reports.
 *
 * A worker can report reality witnessed or work performed. A report is evidence;
 * it is never silently promoted into an institutional directive, asset-state
 * mutation, priority change, completion mutation, or Owner decision.
 */
export function governWorkerReportClaims(
  sourceLabel: string,
  claims: RawReportClaim[],
): GovernedReportClaim[] {
  const safeSource = sourceLabel.trim().slice(0, 120) || "Worker";

  return claims.map((claim) => {
    const ownerAttention = claim.statementType === "recommendation" || claim.statementType === "intention"
      ? "none"
      : claim.ownerAttention;

    return {
      ...claim,
      sourceLabel: safeSource,
      sourceAuthority: "reporting_only",
      permittedStateEffect: "append_source_attributed_evidence_only",
      governingStateChanged: false,
      ownerAttention,
      classification: classificationFor(claim),
    };
  });
}

export function reconciliationLabel(classification: ReconciliationClassification) {
  switch (classification) {
    case "already_recorded": return "Already recorded";
    case "possible_stale_record": return "Atlas may be stale";
    case "possible_unrepresented_work": return "Atlas may have missed this work";
    case "in_progress_report": return "Reported in progress";
    case "intention_only": return "Intention only";
    case "observation_only": return "Attributed observation";
    case "recommendation_only": return "Recommendation only";
    default: return "Ambiguous";
  }
}
