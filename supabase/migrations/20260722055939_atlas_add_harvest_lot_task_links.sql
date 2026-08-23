create table atlas.production_harvest_lot_tasks (
  harvest_lot_id uuid not null references atlas.production_harvest_lots(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  link_role text not null check (link_role in ('container_assignment','conditioning','cooling','release','wash')),
  source text not null default 'production_postharvest_engine',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (harvest_lot_id,task_id,link_role)
);
create index production_harvest_lot_tasks_task_id_idx on atlas.production_harvest_lot_tasks(task_id);

alter table atlas.production_postharvest_gates
  add column cooling_task_id uuid references atlas.tasks(id) on delete set null;
create index production_postharvest_gates_cooling_task_id_idx on atlas.production_postharvest_gates(cooling_task_id);