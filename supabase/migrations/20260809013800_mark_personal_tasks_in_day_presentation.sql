-- Personal obligations may remain visible to Anna, but they must be visibly separate from paid Elm work.

update atlas.tasks t
set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
  'display_family', 'Personal',
  'personal_display_label', 'Personal · not paid Elm work'
)
from atlas.farm_memberships fm
join atlas.farms f on f.id = fm.farm_id
where t.assigned_membership_id = fm.id
  and fm.worker_key = 'anna'
  and f.stable_key = 'elm_farm'
  and coalesce((t.metadata ->> 'personal_task')::boolean, false) = true;
