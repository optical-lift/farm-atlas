export type AtlasPushCategory =
  | "rhythm_warning"
  | "rhythm_due"
  | "rhythm_failure"
  | "unlock"
  | "owner_decision"
  | "other_player_result"
  | "dependency_ready"
  | "tomorrow_covered"
  | "day_plan"
  | "work_window"
  | "task_nudge"
  | "window_closing"
  | "day_wrap";

export type AtlasPushPreferences = {
  enabled: boolean;
  categories: Record<AtlasPushCategory, boolean>;
  quietStart: string | null;
  quietEnd: string | null;
  timeZone: string;
};

export type AtlasPushCategoryPolicy = {
  requiredCategories: AtlasPushCategory[];
  optionalCategories: AtlasPushCategory[];
  canPauseAll: boolean;
  labels: Partial<Record<AtlasPushCategory, string>>;
};

export type AtlasTomorrowCoverage = {
  contractVersion?: string;
  workDate: string;
  taskCount: number;
  momentCount: number;
  uncoveredTaskCount: number;
  firstNotificationAt: string | null;
  deviceConnected: boolean;
  covered: boolean;
  reason?: string;
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
  contractVersion: "atlas_web_push_v1" | "atlas_web_push_v2";
  farmId: string;
  role?: string;
  vapidPublicKey: string | null;
  subscriptions: AtlasPushSubscriptionSummary[];
  preferences: AtlasPushPreferences;
  categoryPolicy?: AtlasPushCategoryPolicy;
  tomorrowCoverage?: AtlasTomorrowCoverage;
};

export type AtlasPushApiResponse = {
  ok: boolean;
  setup?: AtlasPushSetup;
  result?: Record<string, unknown>;
  error?: string;
};
