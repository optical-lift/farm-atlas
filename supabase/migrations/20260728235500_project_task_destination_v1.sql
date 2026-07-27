create or replace function atlas.project_task_destination_v1(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select jsonb_build_object(
    'taskId', t.id,
    'projectId', p.id,
    'projectTitle', p.title
  )
  from atlas.project_task_links ptl
  join atlas.tasks t on t.id = ptl.task_id
  join atlas.projects p on p.id = ptl.project_id
  where ptl.task_id = p_task_id
    and t.task_scope = 'project'
    and atlas.can_read_project(p.id)
  order by ptl.created_at
  limit 1;
$$;

grant execute on function atlas.project_task_destination_v1(uuid) to authenticated;

comment on function atlas.project_task_destination_v1(uuid) is
  'Returns the authorized project destination for a project-scoped task so the universal task doorway never falls into a farm-only task surface.';
