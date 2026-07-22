-- Elm begins with sixty visible Anna tasks, many already overdue. Preserve that
-- truthful current workload while preventing further assigned-task growth.
-- New farms retain the forty-task default.
update atlas.farm_task_release_settings s
set
  maximum_active_tasks_per_member=60,
  metadata=coalesce(s.metadata,'{}'::jsonb)||jsonb_build_object(
    'member_capacity_baseline_reason',
    'Preserve current visible Elm workload while preventing further growth',
    'member_capacity_baseline_set_at',now()
  ),
  updated_at=now()
from atlas.farms f
where f.id=s.farm_id
  and f.stable_key='elm_farm';

-- Remove capacity-evaluation exhaust created while tuning the release engine.
-- Future policy/member capacity rows are throttled to one per occurrence per
-- six hours, and farm-level saturation exits before writing occurrence rows.
delete from atlas.work_gate_evaluations
where outcome='capacity_blocked';
