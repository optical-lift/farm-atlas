-- Owner chooses discretionary Farm Hand work before it becomes a real schedule.
-- Fixed/date-driven work remains real; Finish Elm and serial Weed Cards wait for approval.

update atlas.projects
set metadata = coalesce(metadata,'{}'::jsonb)
  || jsonb_build_object(
    'owner_schedule_approval_required', true,
    'farm_hand_owner_approval_required', true,
    'farm_hand_assigned_work_continues', false,
    'owner_schedule_approval_enabled_at', now()
  ),
  updated_at = now()
where stable_key = 'elm_finish_renovation_pool'
  and status = 'active';

update atlas.task_release_queue_items
set metadata = coalesce(metadata,'{}'::jsonb)
  || jsonb_build_object(
    'owner_schedule_approval_required', true,
    'owner_schedule_approval_enabled_at', now()
  ),
  updated_at = now()
where queue_key = 'anna_weeding_rotation'
  and state = 'queued';
