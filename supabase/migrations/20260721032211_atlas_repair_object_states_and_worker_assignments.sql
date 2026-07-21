insert into atlas.object_state (object_id, farm_id, metadata)
select
  go.id,
  go.farm_id,
  jsonb_build_object(
    'source', 'atlas_transition_repair',
    'reason', 'baseline state created during canonical transition closure'
  )
from atlas.growing_objects go
join atlas.farms f on f.id = go.farm_id
where f.stable_key = 'elm_farm'
  and not exists (
    select 1
    from atlas.object_state os
    where os.object_id = go.id
  )
on conflict (object_id) do nothing;

update atlas.tasks t
set assigned_membership_id = fm.id,
    metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'assignment_migrated_at', now(),
      'assignment_migration', 'anna_metadata_to_membership'
    ),
    updated_at = now()
from atlas.farm_memberships fm
join atlas.farms f on f.id = fm.farm_id
where t.farm_id = fm.farm_id
  and f.stable_key = 'elm_farm'
  and fm.active
  and fm.worker_key = 'anna'
  and t.status in ('open', 'blocked')
  and t.visibility_scope = 'assigned_worker'
  and t.assigned_membership_id is null
  and (
    lower(coalesce(t.metadata ->> 'anna_task', '')) = 'true'
    or lower(coalesce(t.metadata ->> 'assigned_to', '')) = 'anna'
  );
