create unique index if not exists tasks_one_active_engine_instance_uidx
on atlas.tasks (farm_id, engine_instance_key)
where engine_instance_key is not null
  and status in ('open', 'blocked');
