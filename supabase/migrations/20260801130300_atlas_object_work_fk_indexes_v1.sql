begin;

create index if not exists object_work_items_organization_idx
  on atlas.object_work_items(organization_id);

create index if not exists object_work_items_created_by_user_idx
  on atlas.object_work_items(created_by_user_id);

create index if not exists object_work_steps_completed_by_user_idx
  on atlas.object_work_steps(completed_by_user_id);

commit;
