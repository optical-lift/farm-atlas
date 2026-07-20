revoke select on table atlas.tasks from anon;
grant select on table atlas.tasks to authenticated;

drop policy if exists tasks_read_owner on atlas.tasks;
create policy tasks_read_owner
on atlas.tasks
for select
to authenticated
using (atlas.is_farm_owner(farm_id));
