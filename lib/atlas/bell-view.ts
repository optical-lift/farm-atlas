import type { AtlasBell, AtlasBellItem } from "@/lib/atlas/bell-contract";

export type AtlasBellView = "all" | "needs" | "rhythms" | "movement" | "baseline";

export type AtlasBellViewSummary = {
  eyebrow: string;
  status: string;
  title: string;
  emptyMessage: string;
};

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

function active(items: AtlasBellItem[]) {
  return items.filter((item) => !item.acknowledged);
}

export function atlasBellItemsForView(items: AtlasBellItem[], view: AtlasBellView) {
  if (view === "baseline") return items.filter((item) => item.baseline);
  if (view === "needs") {
    return items.filter((item) => !item.baseline && item.requiresAction && item.section !== "rhythms");
  }
  if (view === "rhythms") {
    return items.filter((item) => !item.baseline && item.section === "rhythms");
  }
  if (view === "movement") {
    return items.filter((item) => !item.baseline && item.section === "farm_movement");
  }
  return items.filter((item) => !item.baseline);
}

export function atlasBellViewSummary(
  bell: AtlasBell,
  view: AtlasBellView,
  visibleItems = atlasBellItemsForView(bell.items, view),
): AtlasBellViewSummary {
  const current = bell.items.filter((item) => !item.baseline);
  const directNeeds = active(current.filter((item) => item.requiresAction && item.section !== "rhythms")).length;
  const rhythmNeeds = active(current.filter((item) => item.requiresAction && item.section === "rhythms")).length;
  const visibleUnread = visibleItems.filter((item) => item.unread).length;

  if (view === "needs") {
    return {
      eyebrow: "Direct obligations",
      status: `${directNeeds} direct ${plural(directNeeds, "ask")}`,
      title: `${directNeeds} direct ${plural(directNeeds, "ask")} · ${rhythmNeeds} in Rhythms`,
      emptyMessage: rhythmNeeds > 0
        ? "Nothing needs a direct response here. Due and fallen-out-of-rhythm work stays in Rhythms."
        : "Nothing needs a direct response right now.",
    };
  }

  if (view === "rhythms") {
    return {
      eyebrow: "Rhythm obligations",
      status: `${rhythmNeeds} need attention`,
      title: `${rhythmNeeds} need attention · ${visibleUnread} new`,
      emptyMessage: "No rhythm change belongs in the Bell right now.",
    };
  }

  if (view === "movement") {
    return {
      eyebrow: "Farm movement",
      status: `${visibleItems.length} ${plural(visibleItems.length, "change")}`,
      title: `${visibleItems.length} ${plural(visibleItems.length, "change")} · ${visibleUnread} new`,
      emptyMessage: "No meaningful farm movement belongs in the Bell right now.",
    };
  }

  if (view === "baseline") {
    return {
      eyebrow: "Monitoring baseline",
      status: `${bell.baselineSummary.totalCount} known`,
      title: `${bell.baselineSummary.totalCount} known obligations`,
      emptyMessage: "There is no monitoring baseline to review.",
    };
  }

  return {
    eyebrow: "Current obligations",
    status: `${bell.badgeCount} need you`,
    title: `${bell.badgeCount} need you · ${bell.whileAwayCount} new`,
    emptyMessage: "Nothing belongs in the Bell right now.",
  };
}
