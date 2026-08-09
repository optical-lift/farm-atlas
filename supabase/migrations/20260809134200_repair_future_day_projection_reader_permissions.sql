grant select on table atlas.owner_week_projection to service_role;
grant select on table atlas.farm_memberships to service_role;

alter table atlas.task_release_queue_items enable row level security;

drop policy if exists task_release_queue_items_member_read on atlas.task_release_queue_items;
create policy task_release_queue_items_member_read
on atlas.task_release_queue_items
for select
to authenticated
using (atlas.current_farm_role(farm_id) is not null);

grant select on table atlas.task_release_queue_items to authenticated;
