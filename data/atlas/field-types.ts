export type AtlasTaskStatus = "open" | "done" | "skipped" | "blocked" | "observed";

export type AtlasAreaId =
  | "field_rows"
  | "main_garden"
  | "entry_billboard_garden"
  | "curve_garden"
  | "follow_me_to_flowers"
  | "barn_beds"
  | "berry_walk_original"
  | "berry_walk_flower_rows"
  | "seed_room";

export type AtlasObjectState =
  | "unassigned"
  | "planned"
  | "prepared"
  | "seeded"
  | "germination_check"
  | "germinated"
  | "decision_required"
  | "holding"
  | "planted"
  | "presentable"
  | "suppression"
  | "observe_longer";

export type AtlasActionType =
  | "seed"
  | "direct_sow"
  | "transplant"
  | "pot_up"
  | "water_check"
  | "field_check"
  | "record"
  | "handoff"
  | "observe"
  | "move"
  | "path";

export type AtlasEffect =
  | {
      type: "set_object_state";
      objectId: string;
      nextState: AtlasObjectState;
    }
  | {
      type: "create_followup_task";
      daysAfter: number;
      title: string;
      actionType: AtlasActionType;
    }
  | {
      type: "start_timer";
      objectId: string;
      timerName: "germination" | "hardening" | "handoff" | "garlic_survival";
      days: number;
    }
  | {
      type: "unlock_chain";
      chainId: string;
      unlockText: string;
    };

export type AtlasTask = {
  id: string;
  date: string;
  title: string;
  areaId: AtlasAreaId;
  objectId?: string;
  actionType: AtlasActionType;
  instructions: string;
  unlockText: string;
  status: AtlasTaskStatus;
  packet?: string;
  also?: string;
  ifDone?: AtlasEffect[];
  ifSkipped?: AtlasEffect[];
  ifBlocked?: AtlasEffect[];
};

export type AtlasArea = {
  id: AtlasAreaId;
  label: string;
  priority: number;
  mode: string;
  currentGoal: string;
  guardrail: string;
  allowedCrops2026?: string[];
};

export type StoredTaskState = {
  status: AtlasTaskStatus;
  updatedAt: string;
  blockerReason?: string;
  observation?: string;
};

export type AtlasTaskStateMap = Record<string, StoredTaskState>;
