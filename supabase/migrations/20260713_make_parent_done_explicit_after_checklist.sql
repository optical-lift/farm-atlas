-- Keep the parent Done button as the explicit final action.
-- Child rows remain independently tappable, but completing the last child does not
-- silently close the parent. Parent Done still cascades to any unfinished children.

drop trigger if exists trg_auto_complete_parent_when_checklist_done on atlas.tasks;

comment on function atlas.auto_complete_parent_when_checklist_done() is
  'Legacy child-to-parent auto-completion function retained for migration compatibility. Its trigger is disabled so the parent remains open until Done is pressed.';

comment on function atlas.complete_child_checklist_when_parent_done() is
  'When the explicit parent Done action marks a parent complete, completes every remaining non-archived checklist child and records a child outcome event.';