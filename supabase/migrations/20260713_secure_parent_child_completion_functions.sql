-- Trigger functions are internal database machinery, not callable Atlas RPCs.
-- The legacy child-to-parent function is no longer used because parent Done is explicit.

drop function if exists atlas.auto_complete_parent_when_checklist_done();

revoke all on function atlas.complete_child_checklist_when_parent_done()
  from public, anon, authenticated;