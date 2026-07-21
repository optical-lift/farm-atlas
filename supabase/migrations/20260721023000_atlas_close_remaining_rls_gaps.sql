create or replace function atlas.has_any_active_membership()
returns boolean
language sql
stable
security definer
set search_path to 'atlas', 'public'
as $function$
  select exists (
    select 1
    from atlas.farm_memberships fm
    where fm.user_id = auth.uid()
      and fm.active = true
  )
$function$;

revoke all on function atlas.has_any_active_membership() from public, anon;
grant execute on function atlas.has_any_active_membership() to authenticated, service_role;

alter table atlas.inbox_items enable row level security;
alter table atlas.object_activity_events enable row level security;
alter table atlas.rhythm_templates enable row level security;
alter table atlas.project_task_links enable row level security;
alter table atlas.crop_cycle_impacts enable row level security;
alter table atlas.crop_profile_aliases enable row level security;
alter table atlas.crop_observation_types enable row level security;
alter table atlas.task_crop_cycles enable row level security;

revoke all on atlas.inbox_items from anon, authenticated;
revoke all on atlas.object_activity_events from anon, authenticated;
revoke all on atlas.rhythm_templates from anon, authenticated;
revoke all on atlas.project_task_links from anon, authenticated;
revoke all on atlas.crop_cycle_impacts from anon, authenticated;
revoke all on atlas.crop_profile_aliases from anon, authenticated;
revoke all on atlas.crop_observation_types from anon, authenticated;
revoke all on atlas.task_crop_cycles from anon, authenticated;

drop policy if exists inbox_items_read_operations on atlas.inbox_items;
create policy inbox_items_read_operations
on atlas.inbox_items for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists object_activity_events_read_operations on atlas.object_activity_events;
create policy object_activity_events_read_operations
on atlas.object_activity_events for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists rhythm_templates_read_operations on atlas.rhythm_templates;
create policy rhythm_templates_read_operations
on atlas.rhythm_templates for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists crop_cycle_impacts_read_operations on atlas.crop_cycle_impacts;
create policy crop_cycle_impacts_read_operations
on atlas.crop_cycle_impacts for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

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
);

drop policy if exists task_crop_cycles_read_operations on atlas.task_crop_cycles;
create policy task_crop_cycles_read_operations
on atlas.task_crop_cycles for select to authenticated
using (
  exists (
    select 1
    from atlas.tasks t
    where t.id = task_crop_cycles.task_id
      and atlas.can_read_farm_operations(t.farm_id)
  )
);

drop policy if exists crop_profile_aliases_read_member on atlas.crop_profile_aliases;
create policy crop_profile_aliases_read_member
on atlas.crop_profile_aliases for select to authenticated
using (atlas.has_any_active_membership());

drop policy if exists crop_observation_types_read_member on atlas.crop_observation_types;
create policy crop_observation_types_read_member
on atlas.crop_observation_types for select to authenticated
using (atlas.has_any_active_membership());

grant select on atlas.inbox_items to authenticated;
grant select on atlas.object_activity_events to authenticated;
grant select on atlas.rhythm_templates to authenticated;
grant select on atlas.project_task_links to authenticated;
grant select on atlas.crop_cycle_impacts to authenticated;
grant select on atlas.crop_profile_aliases to authenticated;
grant select on atlas.crop_observation_types to authenticated;
grant select on atlas.task_crop_cycles to authenticated;