export type AtlasPushCategory =
  | "rhythm_warning"
  | "rhythm_due"
  | "rhythm_failure"
  | "unlock"
  | "owner_decision"
  | "other_player_result";

export type AtlasPushPreferences = {
  enabled: boolean;
  categories: Record<AtlasPushCategory, boolean>;
  quietStart: string | null;
  quietEnd: string | null;
  timeZone: string;
};

export type AtlasPushSubscriptionSummary = {
  id: string;
  endpointHash: string;
  deviceLabel: string | null;
  status: string;
  lastSeenAt: string | null;
  lastSuccessAt: string | null;
};

export type AtlasPushSetup = {
  contractVersion: "atlas_web_push_v1";
  farmId: string;
  vapidPublicKey: string | null;
  subscriptions: AtlasPushSubscriptionSummary[];
  preferences: AtlasPushPreferences;
};

export type AtlasPushApiResponse = {
  ok: boolean;
  setup?: AtlasPushSetup;
  result?: Record<string, unknown>;
  error?: string;
};
