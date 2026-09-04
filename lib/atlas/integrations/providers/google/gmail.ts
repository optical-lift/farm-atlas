export const GMAIL_METADATA_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export type GmailReadProfile = "metadata_only" | "message_read";

/**
 * Gmail scope policy is explicit so Atlas can ask only for the access warranted
 * by the feature being connected. No send, modify, settings, or delete scope is
 * included in either read profile.
 */
export function gmailScopesFor(profile: GmailReadProfile): readonly string[] {
  if (profile === "metadata_only") return [GMAIL_METADATA_SCOPE];
  return [GMAIL_READONLY_SCOPE];
}
