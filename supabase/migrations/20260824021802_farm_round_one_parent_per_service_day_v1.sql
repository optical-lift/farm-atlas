create unique index if not exists planned_work_occurrences_one_farm_round_parent_per_day_v1
on atlas.planned_work_occurrences (farm_id, planned_due_date)
where metadata->>'farmRoundParent'='true';