drop policy if exists project_task_links_read_operations on atlas.project_task_links;
create policy project_task_links_read_operations
on atlas.project_task_links for select to authenticated
using (
  exists (
    select 1
    from atlas.projects p
    where p.id = project_task_links.project_id
      and atlas.can_read_farm_operations(p.farm_id)
  )
  and exists (
    select 1
    from atlas.tasks t
    where t.id = project_task_links.task_id
  )
);

drop policy if exists task_crop_cycles_read_operations on atlas.task_crop_cycles;
create policy task_crop_cycles_read_operations
on atlas.task_crop_cycles for select to authenticated
using (
  exists (
    select 1
    from atlas.tasks t
    where t.id = task_crop_cycles.task_id
  )
  and exists (
    select 1
    from atlas.crop_cycles cc
    where cc.id = task_crop_cycles.crop_cycle_id
      and atlas.can_read_farm_operations(cc.farm_id)
  )
);