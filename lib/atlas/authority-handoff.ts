import type { AtlasInputResultEvent } from "@/lib/atlas/input-contract";

export type AtlasAuthorityHandoffValue =
  | string
  | number
  | boolean
  | null
  | AtlasAuthorityHandoffValue[]
  | { [key: string]: AtlasAuthorityHandoffValue };

export type AtlasAuthorityHandoffSource = {
  eventType: string;
  contractId: string;
  recordedAt: string;
  source: AtlasInputResultEvent["source"];
};

export type AtlasAuthorityClaimState = "required" | "not_recorded";

export type AtlasAuthorityClaim = {
  id: string;
  kind: string;
  authority: string;
  state: AtlasAuthorityClaimState;
  source: AtlasAuthorityHandoffSource;
  payload: Record<string, AtlasAuthorityHandoffValue>;
};

export type AtlasInstitutionalWorkClaim = {
  ledger: "company_work";
  state: "open";
  organizationRef: string;
  title: string;
  instructions: string | null;
  operationClass: string;
  jurisdictionKey: string;
  source: AtlasAuthorityHandoffSource;
  dependsOnAuthorityClaimIds: string[];
};

export type AtlasAuthorityHandoff = {
  sourceEvent: AtlasAuthorityHandoffSource;
  persistence: AtlasInputResultEvent["persistence"];
  authorityClaims: AtlasAuthorityClaim[];
  institutionalWork: AtlasInstitutionalWorkClaim[];
};

type AtlasAuthorityClaimDraft = Omit<AtlasAuthorityClaim, "source">;
type AtlasInstitutionalWorkClaimDraft = Omit<AtlasInstitutionalWorkClaim, "source">;

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required for an Atlas authority handoff.`);
  return normalized;
}

function sourceFromEvent(event: AtlasInputResultEvent): AtlasAuthorityHandoffSource {
  return {
    eventType: event.eventType,
    contractId: event.contractId,
    recordedAt: event.recordedAt,
    source: event.source,
  };
}

/**
 * A handoff records what another authority must resolve. It does not resolve the claim, mutate the target ledger,
 * or promote source evidence into a truth that belongs to a different authority.
 */
export function createAtlasAuthorityHandoff(
  event: AtlasInputResultEvent,
  input: {
    authorityClaims?: AtlasAuthorityClaimDraft[];
    institutionalWork?: AtlasInstitutionalWorkClaimDraft[];
  },
): AtlasAuthorityHandoff {
  const sourceEvent = sourceFromEvent(event);
  const claimIds = new Set<string>();

  const authorityClaims = (input.authorityClaims ?? []).map((claim) => {
    const id = requiredText(claim.id, "Authority claim id");
    if (claimIds.has(id)) throw new Error(`Duplicate Atlas authority claim id: ${id}`);
    claimIds.add(id);

    return {
      ...claim,
      id,
      kind: requiredText(claim.kind, "Authority claim kind"),
      authority: requiredText(claim.authority, "Authority"),
      source: sourceEvent,
    };
  });

  const institutionalWork = (input.institutionalWork ?? []).map((work) => {
    work.dependsOnAuthorityClaimIds.forEach((claimId) => {
      if (!claimIds.has(claimId)) {
        throw new Error(`Institutional work depends on unknown authority claim: ${claimId}`);
      }
    });

    return {
      ...work,
      organizationRef: requiredText(work.organizationRef, "Institutional work organization"),
      title: requiredText(work.title, "Institutional work title"),
      operationClass: requiredText(work.operationClass, "Institutional work operation class"),
      jurisdictionKey: requiredText(work.jurisdictionKey, "Institutional work jurisdiction"),
      source: sourceEvent,
    };
  });

  return {
    sourceEvent,
    persistence: event.persistence,
    authorityClaims,
    institutionalWork,
  };
}
