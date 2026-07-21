create or replace function atlas.can_read_farm_operations(requested_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'atlas', 'public'
as $function$
  select coalesce(
    atlas.current_farm_role(requested_farm_id) in ('owner', 'manager'),
    false
  )
$function$;

create or replace function atlas.has_operations_membership()
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
      and fm.role in ('owner', 'manager')
  )
$function$;

revoke all on function atlas.can_read_farm_operations(uuid) from public, anon;
revoke all on function atlas.has_operations_membership() from public, anon;
grant execute on function atlas.can_read_farm_operations(uuid) to authenticated, service_role;
grant execute on function atlas.has_operations_membership() to authenticated, service_role;

-- Direct farm-scoped operational tables.
drop policy if exists zones_read_operations on atlas.zones;
create policy zones_read_operations on atlas.zones for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists growing_objects_read_operations on atlas.growing_objects;
create policy growing_objects_read_operations on atlas.growing_objects for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists field_logs_read_operations on atlas.field_logs;
create policy field_logs_read_operations on atlas.field_logs for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists planting_claims_read_operations on atlas.planting_claims;
create policy planting_claims_read_operations on atlas.planting_claims for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists object_contents_read_operations on atlas.object_contents;
create policy object_contents_read_operations on atlas.object_contents for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists object_state_read_operations on atlas.object_state;
create policy object_state_read_operations on atlas.object_state for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists projects_read_operations on atlas.projects;
create policy projects_read_operations on atlas.projects for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists resources_read_operations on atlas.resources;
create policy resources_read_operations on atlas.resources for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists project_goals_read_operations on atlas.project_goals;
create policy project_goals_read_operations on atlas.project_goals for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists task_outcome_events_read_operations on atlas.task_outcome_events;
create policy task_outcome_events_read_operations on atlas.task_outcome_events for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists crop_cycles_read_operations on atlas.crop_cycles;
create policy crop_cycles_read_operations on atlas.crop_cycles for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists plant_lineages_read_operations on atlas.plant_lineages;
create policy plant_lineages_read_operations on atlas.plant_lineages for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists plant_instances_read_operations on atlas.plant_instances;
create policy plant_instances_read_operations on atlas.plant_instances for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists propagation_events_read_operations on atlas.propagation_events;
create policy propagation_events_read_operations on atlas.propagation_events for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists maintenance_objects_read_operations on atlas.maintenance_objects;
create policy maintenance_objects_read_operations on atlas.maintenance_objects for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists maintenance_scheduler_settings_read_operations on atlas.maintenance_scheduler_settings;
create policy maintenance_scheduler_settings_read_operations on atlas.maintenance_scheduler_settings for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists maintenance_dependencies_read_operations on atlas.maintenance_dependencies;
create policy maintenance_dependencies_read_operations on atlas.maintenance_dependencies for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists maintenance_history_read_operations on atlas.maintenance_history;
create policy maintenance_history_read_operations on atlas.maintenance_history for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists truth_sources_read_operations on atlas.truth_sources;
create policy truth_sources_read_operations on atlas.truth_sources for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists truth_assertions_read_operations on atlas.truth_assertions;
create policy truth_assertions_read_operations on atlas.truth_assertions for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists integrity_audit_runs_read_operations on atlas.integrity_audit_runs;
create policy integrity_audit_runs_read_operations on atlas.integrity_audit_runs for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists identity_review_queue_read_operations on atlas.identity_review_queue;
create policy identity_review_queue_read_operations on atlas.identity_review_queue for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists object_content_resolutions_read_operations on atlas.object_content_resolutions;
create policy object_content_resolutions_read_operations on atlas.object_content_resolutions for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists object_content_entity_links_read_operations on atlas.object_content_entity_links;
create policy object_content_entity_links_read_operations on atlas.object_content_entity_links for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists task_transitions_read_operations on atlas.task_transitions;
create policy task_transitions_read_operations on atlas.task_transitions for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists production_plans_read_operations on atlas.production_plans;
create policy production_plans_read_operations on atlas.production_plans for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

-- Shared catalogs required by operational projections.
drop policy if exists crop_profiles_read_operations on atlas.crop_profiles;
create policy crop_profiles_read_operations on atlas.crop_profiles for select to authenticated
using (atlas.has_operations_membership());

drop policy if exists action_requirement_templates_read_operations on atlas.action_requirement_templates;
create policy action_requirement_templates_read_operations on atlas.action_requirement_templates for select to authenticated
using (
  (farm_id is null and atlas.has_operations_membership())
  or atlas.can_read_farm_operations(farm_id)
);

drop policy if exists maintenance_type_profiles_read_operations on atlas.maintenance_type_profiles;
create policy maintenance_type_profiles_read_operations on atlas.maintenance_type_profiles for select to authenticated
using (atlas.has_operations_membership());

drop policy if exists production_rule_templates_read_operations on atlas.production_rule_templates;
create policy production_rule_templates_read_operations on atlas.production_rule_templates for select to authenticated
using (atlas.has_operations_membership());

-- Farm-scoped joins inherit the parent record's authorization.
drop policy if exists field_log_objects_read_operations on atlas.field_log_objects;
create policy field_log_objects_read_operations on atlas.field_log_objects for select to authenticated
using (
  exists (
    select 1 from atlas.field_logs fl
    where fl.id = field_log_id
      and atlas.can_read_farm_operations(fl.farm_id)
  )
);

drop policy if exists planting_claim_objects_read_operations on atlas.planting_claim_objects;
create policy planting_claim_objects_read_operations on atlas.planting_claim_objects for select to authenticated
using (
  exists (
    select 1 from atlas.planting_claims pc
    where pc.id = planting_claim_id
      and atlas.can_read_farm_operations(pc.farm_id)
  )
);

drop policy if exists task_objects_read_operations on atlas.task_objects;
create policy task_objects_read_operations on atlas.task_objects for select to authenticated
using (
  exists (
    select 1 from atlas.tasks t
    where t.id = task_id
      and atlas.can_read_farm_operations(t.farm_id)
  )
);

drop policy if exists project_steps_read_operations on atlas.project_steps;
create policy project_steps_read_operations on atlas.project_steps for select to authenticated
using (
  exists (
    select 1 from atlas.projects p
    where p.id = project_id
      and atlas.can_read_farm_operations(p.farm_id)
  )
);

drop policy if exists task_resource_requirements_read_operations on atlas.task_resource_requirements;
create policy task_resource_requirements_read_operations on atlas.task_resource_requirements for select to authenticated
using (
  exists (
    select 1 from atlas.tasks t
    where t.id = task_id
      and atlas.can_read_farm_operations(t.farm_id)
  )
);

drop policy if exists production_successions_read_operations on atlas.production_successions;
create policy production_successions_read_operations on atlas.production_successions for select to authenticated
using (
  exists (
    select 1 from atlas.production_plans pp
    where pp.id = production_plan_id
      and atlas.can_read_farm_operations(pp.farm_id)
  )
);

-- Owner/Manager directories may read people attached to a farm they operate.
drop policy if exists farm_memberships_read_operations on atlas.farm_memberships;
create policy farm_memberships_read_operations on atlas.farm_memberships for select to authenticated
using (atlas.can_read_farm_operations(farm_id));

drop policy if exists user_profiles_read_operations on atlas.user_profiles;
create policy user_profiles_read_operations on atlas.user_profiles for select to authenticated
using (
  exists (
    select 1
    from atlas.farm_memberships target_membership
    where target_membership.user_id = user_profiles.user_id
      and target_membership.active = true
      and atlas.can_read_farm_operations(target_membership.farm_id)
  )
);

create or replace view atlas.v_farm_object_operational_state
with (security_invoker = true)
as
select
  f.id as farm_id,
  f.stable_key as farm_key,
  f.name as farm_name,
  z.id as zone_id,
  z.stable_key as zone_key,
  z.label as zone_label,
  z.sort_order as zone_sort_order,
  go.id as object_id,
  go.stable_key as object_key,
  go.label as object_label,
  go.object_type,
  go.object_mode,
  go.sort_order as object_sort_order,
  go.length_ft,
  go.width_ft,
  go.area_sqft,
  go.guest_visible,
  coalesce(os.life_status, 'open') as life_status,
  coalesce(os.weed_pressure, 'unknown') as weed_pressure,
  coalesce(os.water_status, 'unknown') as water_status,
  os.presentability,
  coalesce(os.decision_required, false) as decision_required,
  os.harvest_confidence,
  greatest(
    os.last_touched_at,
    os.last_weeded_at,
    os.last_watered_at,
    os.last_checked_at,
    current_cycle.updated_at::date
  ) as last_action_date,
  case
    when os.last_weeded_at is not null
      and os.last_weeded_at = greatest(os.last_touched_at, os.last_weeded_at, os.last_watered_at, os.last_checked_at, current_cycle.updated_at::date)
      then 'Weeded'
    when os.last_watered_at is not null
      and os.last_watered_at = greatest(os.last_touched_at, os.last_weeded_at, os.last_watered_at, os.last_checked_at, current_cycle.updated_at::date)
      then 'Watered'
    when os.last_checked_at is not null
      and os.last_checked_at = greatest(os.last_touched_at, os.last_weeded_at, os.last_watered_at, os.last_checked_at, current_cycle.updated_at::date)
      then 'Checked'
    when current_cycle.updated_at is not null
      and current_cycle.updated_at::date = greatest(os.last_touched_at, os.last_weeded_at, os.last_watered_at, os.last_checked_at, current_cycle.updated_at::date)
      then 'Crop state updated'
    when os.last_touched_at is not null then 'Object updated'
    else null
  end as last_action_label,
  current_cycle.id as current_crop_cycle_id,
  current_cycle.crop_cycle_key,
  current_cycle.crop_label,
  current_cycle.variety,
  current_cycle.cycle_state as crop_stage,
  current_cycle.lifecycle_status as crop_lifecycle_status,
  current_cycle.sown_date,
  current_cycle.planted_date,
  current_cycle.expected_germination_start,
  current_cycle.expected_germination_end,
  current_cycle.expected_harvest_watch_start,
  current_cycle.expected_harvest_watch_end,
  current_cycle.expected_clear_date,
  coalesce(current_cycle.cycle_state, os.life_status, 'open') as current_stage,
  next_task.id as next_task_id,
  next_task.title as next_action,
  next_task.status as next_task_status,
  next_task.due_date as next_action_due,
  next_task.work_class as next_work_class,
  next_task.visibility_scope as next_task_visibility,
  next_task.assigned_membership_id,
  coalesce(
    nullif(next_task.blocker_text, ''),
    case when coalesce(os.decision_required, false) then 'Decision required' end
  ) as blocker,
  top_maintenance.maintenance_type as next_maintenance_type,
  top_maintenance.condition as next_maintenance_condition,
  top_maintenance.next_eligible_date as next_maintenance_date,
  coalesce(maintenance_summary.maintenance_due_count, 0) as maintenance_due_count,
  maintenance_summary.next_maintenance_due,
  coalesce(maintenance_summary.max_maintenance_priority, 0) as max_maintenance_priority,
  coalesce(maintenance_summary.max_maintenance_risk, 0) as max_maintenance_risk,
  case
    when next_task.id is not null then 'task'
    when top_maintenance.id is not null then 'maintenance'
    else 'none'
  end as next_action_source,
  case
    when coalesce(os.decision_required, false) then 'critical'
    when next_task.status = 'blocked' and coalesce(next_task.due_date, current_date) <= current_date then 'critical'
    when next_task.status = 'blocked' then 'high'
    when next_task.due_date is not null and next_task.due_date < current_date then 'high'
    when coalesce(maintenance_summary.max_maintenance_risk, 0) >= 75 then 'high'
    when next_task.due_date is not null and next_task.due_date <= current_date + 7 then 'medium'
    when coalesce(maintenance_summary.maintenance_due_count, 0) > 0 then 'medium'
    when coalesce(os.weed_pressure, 'unknown') in ('high', 'severe', 'bermuda_mat') then 'medium'
    else 'low'
  end as risk_level
from atlas.growing_objects go
join atlas.farms f on f.id = go.farm_id
left join atlas.zones z on z.id = go.zone_id
left join atlas.object_state os on os.object_id = go.id
left join lateral (
  select cc.*
  from atlas.crop_cycles cc
  where cc.object_id = go.id
    and cc.lifecycle_status = 'active'
  order by coalesce(cc.sown_date, cc.planted_date, cc.created_at::date) desc, cc.created_at desc
  limit 1
) current_cycle on true
left join lateral (
  select t.*
  from atlas.task_objects task_link
  join atlas.tasks t on t.id = task_link.task_id
  where task_link.object_id = go.id
    and t.status in ('open', 'blocked')
  order by
    case when t.status = 'blocked' then 0 else 1 end,
    case when t.due_date is null then 1 else 0 end,
    t.due_date,
    case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
    t.created_at
  limit 1
) next_task on true
left join lateral (
  select mo.*
  from atlas.maintenance_objects mo
  where mo.object_id = go.id
    and mo.active = true
  order by
    case when mo.next_eligible_date <= current_date then 0 else 1 end,
    mo.priority_score desc,
    mo.next_eligible_date,
    mo.created_at
  limit 1
) top_maintenance on true
left join lateral (
  select
    count(*) filter (where mo.next_eligible_date <= current_date)::integer as maintenance_due_count,
    min(mo.next_eligible_date) as next_maintenance_due,
    max(mo.priority_score) as max_maintenance_priority,
    max(greatest(
      mo.crop_loss_risk,
      mo.revenue_unlock_score,
      mo.planting_block_score,
      mo.guest_visibility_score,
      mo.weed_spread_risk,
      mo.upcoming_booking_score
    ))::integer as max_maintenance_risk
  from atlas.maintenance_objects mo
  where mo.object_id = go.id
    and mo.active = true
) maintenance_summary on true;

comment on view atlas.v_farm_object_operational_state is
  'Prepared Owner/Manager read model for farm, zone, object, crop stage, last action, next action, blocker, maintenance, assignment, and risk.';

grant select on atlas.v_farm_object_operational_state to authenticated, service_role;