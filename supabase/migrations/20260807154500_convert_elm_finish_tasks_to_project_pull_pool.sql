-- Convert the expired South Dakota departure sprint into a durable Elm finish pool.
-- This migration is intentionally scoped to atlas.* in the shared Noel/Atlas Supabase project.

do $migration$
declare
  v_project_id uuid;
begin
  select id into v_project_id
  from atlas.projects
  where stable_key in ('elm_south_dakota_departure_finish_20260805','elm_finish_renovation_pool')
  order by case stable_key when 'elm_finish_renovation_pool' then 0 else 1 end
  limit 1;

  if v_project_id is null then
    raise exception 'Elm finish project not found.';
  end if;

  update atlas.projects
  set stable_key='elm_finish_renovation_pool',
      title='Elm Finish + Renovation Pool',
      target_date=null,
      current_milestone='Pull finite finish work into Daily Hands',
      health_status='moving',
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'daily_pull_enabled',true,
        'daily_pull_minutes',90,
        'daily_pull_choice_limit',8,
        'daily_pull_max_items',1,
        'daily_pull_lane','physical',
        'converted_from_departure_sprint',true,
        'converted_at',now()
      ),
      updated_at=now()
  where id=v_project_id;

  insert into atlas.project_pull_items(
    project_id,farm_id,organization_id,source_task_id,title,note,status,preferred_membership_id,
    expected_active_minutes,physical_load,work_class,environment,location_text,priority,metadata
  )
  select
    v_project_id,
    task.farm_id,
    task.organization_id,
    task.id,
    task.title,
    task.note,
    'available',
    task.assigned_membership_id,
    coalesce(capacity.expected_active_minutes,
      case when task.work_class='light' then 30 when task.work_class='heavy' then 120 else 60 end),
    coalesce(capacity.physical_load,
      case when task.work_class='light' then 'light' when task.work_class='heavy' then 'heavy' else 'moderate' end),
    task.work_class,
    case
      when lower(task.title) ~ '(exterior|porch|pool gate|lattice|outside)' then 'outdoor'
      when lower(task.title) ~ '(buy |return )' then 'either'
      else 'indoor'
    end,
    null,
    coalesce(task.priority,'normal'),
    jsonb_build_object(
      'source_task_title',task.title,
      'source_task_due_date',task.due_date,
      'source_task_status',task.status,
      'source_task_work_lane',task.work_lane,
      'source_task_commitment_kind',task.commitment_kind,
      'source_blocker_text',task.blocker_text,
      'source_effort_units',task.effort_units,
      'migrated_from_timed_task',true,
      'migrated_at',now()
    )
  from atlas.tasks task
  left join atlas.task_capacity_profiles capacity on capacity.task_id=task.id
  left join atlas.farm_memberships membership on membership.id=task.assigned_membership_id
  where task.status in ('open','blocked')
    and task.farm_id=(select farm_id from atlas.projects where id=v_project_id)
    and task.id not in (select source_task_id from atlas.project_pull_items where project_id=v_project_id and source_task_id is not null)
    and (
      exists (
        select 1 from atlas.project_task_links project_link
        where project_link.project_id=v_project_id
          and project_link.task_id=task.id
      )
      or (
        membership.worker_key in ('anna','marshall')
        and lower(task.title) ~ '(upper kitchen cabinets|prepare farm work area in basement|cafe lights|kitchen ceiling|attic bathroom hardware|interior windows|exterior windows|exterior house doors|lounge chairs|lounge floorboards|pressure wash back porch|garage upright freezer|venue bathroom|attic locking door|occupied lock|basement wall elbow|venue toilet|closet hardware|venue mirrors|existing trim|damaged flooring|basement ceiling pipe|attic bathroom door surround|basement outlet covers|flooring patches|new trim|working dryer|attic outlets|lattice and pool gate|basement pantry light|replace valve sealant)'
      )
    )
    and task.title <> 'Owner — Reimburse Melody'
  on conflict (project_id,source_task_id) do nothing;

  insert into atlas.project_pull_item_dependencies(project_item_id,prerequisite_item_id,required_status)
  select downstream_item.id,prerequisite_item.id,'completed'
  from atlas.task_prerequisites prerequisite
  join atlas.project_pull_items downstream_item
    on downstream_item.project_id=v_project_id
   and downstream_item.source_task_id=prerequisite.downstream_task_id
  join atlas.project_pull_items prerequisite_item
    on prerequisite_item.project_id=v_project_id
   and prerequisite_item.source_task_id=prerequisite.prerequisite_task_id
  where prerequisite.active
  on conflict (project_item_id,prerequisite_item_id) do nothing;

  -- The original rows become immutable historical source records. They no longer
  -- carry calendar pressure; future execution is materialized only when a worker pulls an item.
  update atlas.tasks source_task
  set status='archived',
      due_date=null,
      commitment_kind='floating',
      work_lane='discretionary',
      metadata=coalesce(source_task.metadata,'{}'::jsonb) || jsonb_build_object(
        'project_pool_source',true,
        'project_pool_project_id',v_project_id,
        'project_pool_archived_at',now()
      ),
      updated_at=now()
  where source_task.id in (
    select item.source_task_id
    from atlas.project_pull_items item
    where item.project_id=v_project_id
      and item.source_task_id is not null
  )
    and source_task.status in ('open','blocked');
end;
$migration$;
