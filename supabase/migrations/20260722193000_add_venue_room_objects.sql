-- Model Elm Farm's rentable indoor rooms as first-class Atlas objects.
-- Tasks remain independently assigned to people; place and work category are
-- canonical task relationships rather than person-specific task buckets.

alter table atlas.growing_objects
  drop constraint if exists growing_objects_object_type_check;

alter table atlas.growing_objects
  add constraint growing_objects_object_type_check
  check (object_type = any (array[
    'bed'::text,
    'path'::text,
    'arch_bed'::text,
    'area'::text,
    'corridor'::text,
    'seed_room'::text,
    'zone_summary'::text,
    'room'::text
  ]));

with elm as (
  select id
  from atlas.farms
  where stable_key = 'elm_farm'
)
insert into atlas.zones (
  farm_id,
  stable_key,
  label,
  zone_type,
  mode_bias,
  goal_text,
  current_state,
  visible_to_guests,
  sort_order,
  metadata
)
select
  elm.id,
  'venue',
  'Venue',
  'venue',
  'rental_operations',
  'Keep every rentable room safe, complete, presentable, and ready to earn revenue.',
  'active_buildout',
  true,
  15,
  jsonb_build_object(
    'source', 'owner_instruction_20260722',
    'room_count', 6,
    'operating_model', 'room_first',
    'guest_facing', true,
    'rental_readiness', 'work_in_progress'
  )
from elm
on conflict (farm_id, stable_key) do update
set label = excluded.label,
    zone_type = excluded.zone_type,
    mode_bias = excluded.mode_bias,
    goal_text = excluded.goal_text,
    current_state = excluded.current_state,
    visible_to_guests = excluded.visible_to_guests,
    sort_order = excluded.sort_order,
    metadata = coalesce(atlas.zones.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with venue as (
  select z.farm_id, z.id as zone_id
  from atlas.zones z
  join atlas.farms f on f.id = z.farm_id
  where f.stable_key = 'elm_farm'
    and z.stable_key = 'venue'
), rooms(stable_key, label, sort_order) as (
  values
    ('venue_lounge', 'Lounge', 10),
    ('venue_library', 'Library', 20),
    ('venue_kitchen', 'Kitchen', 30),
    ('venue_conference_room', 'Conference Room', 40),
    ('venue_bathroom', 'Bathroom', 50),
    ('venue_studio', 'Studio', 60)
)
insert into atlas.growing_objects (
  farm_id,
  zone_id,
  stable_key,
  label,
  object_type,
  object_mode,
  guest_visible,
  sort_order,
  metadata
)
select
  venue.farm_id,
  venue.zone_id,
  rooms.stable_key,
  rooms.label,
  'room',
  'rental_room',
  true,
  rooms.sort_order,
  jsonb_build_object(
    'source', 'owner_instruction_20260722',
    'object_subtype', 'rentable_room',
    'is_growing_space', false,
    'guest_facing', true,
    'rental_readiness', 'work_in_progress',
    'booking_ready', false
  )
from venue
cross join rooms
on conflict (farm_id, stable_key) do update
set zone_id = excluded.zone_id,
    label = excluded.label,
    object_type = excluded.object_type,
    object_mode = excluded.object_mode,
    guest_visible = excluded.guest_visible,
    sort_order = excluded.sort_order,
    metadata = coalesce(atlas.growing_objects.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

-- Preserve the previously logged Lounge Floor as a component record without
-- letting it compete with the Lounge room in the primary zone registry.
with venue as (
  select z.farm_id, z.id as zone_id
  from atlas.zones z
  join atlas.farms f on f.id = z.farm_id
  where f.stable_key = 'elm_farm'
    and z.stable_key = 'venue'
)
update atlas.growing_objects go
set zone_id = venue.zone_id,
    metadata = coalesce(go.metadata, '{}'::jsonb) || jsonb_build_object(
      'parent_room_key', 'venue_lounge',
      'component_of', 'venue_lounge',
      'registry_hidden', true
    ),
    updated_at = now()
from venue
where go.farm_id = venue.farm_id
  and go.stable_key = 'lounge_floor';

-- Normalize the venue buildout tasks to the Venue zone and meaningful work
-- categories. Marshall remains the assignee; his name is not the category.
with venue as (
  select z.farm_id, z.id as zone_id
  from atlas.zones z
  join atlas.farms f on f.id = z.farm_id
  where f.stable_key = 'elm_farm'
    and z.stable_key = 'venue'
), marshall as (
  select fm.id
  from atlas.farm_memberships fm
  join venue on venue.farm_id = fm.farm_id
  where fm.active = true
    and fm.worker_key = 'marshall'
  order by fm.created_at
  limit 1
)
update atlas.tasks t
set zone_id = venue.zone_id,
    action_key = 'venue',
    task_type = case
      when lower(t.title) like '%sign%' then 'venue_signage'
      when lower(t.title) like '%stair tread%' then 'venue_access_safety'
      when lower(t.title) like '%window%' then 'venue_windows'
      when lower(t.title) like '%floor%' then 'venue_flooring'
      when lower(t.title) like '%white board%' or lower(t.title) like '%whiteboard%' then 'venue_furnishings'
      when lower(t.title) like '%trim%' or lower(t.title) like '%wallpaper%' then 'venue_finish'
      when lower(t.title) like '%door%' or lower(t.title) like '%hardware%' or lower(t.title) like '%lock%' then 'venue_hardware'
      else 'venue_buildout'
    end,
    metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'work_route', 'venue',
      'work_rhythm', 'Venue Buildout',
      'collection_zone', 'Venue',
      'work_category_key', case
        when lower(t.title) like '%sign%' then 'signage_safety'
        when lower(t.title) like '%stair tread%' then 'access_safety'
        when lower(t.title) like '%window%' then 'windows'
        when lower(t.title) like '%floor%' then 'flooring'
        when lower(t.title) like '%white board%' or lower(t.title) like '%whiteboard%' then 'furnishings_installation'
        when lower(t.title) like '%trim%' or lower(t.title) like '%wallpaper%' then 'trim_finish'
        when lower(t.title) like '%door%' or lower(t.title) like '%hardware%' or lower(t.title) like '%lock%' then 'doors_hardware'
        else 'venue_buildout'
      end,
      'work_category_label', case
        when lower(t.title) like '%sign%' then 'Signage + safety'
        when lower(t.title) like '%stair tread%' then 'Access + safety'
        when lower(t.title) like '%window%' then 'Windows'
        when lower(t.title) like '%floor%' then 'Flooring'
        when lower(t.title) like '%white board%' or lower(t.title) like '%whiteboard%' then 'Furnishings + installation'
        when lower(t.title) like '%trim%' or lower(t.title) like '%wallpaper%' then 'Trim + finish'
        when lower(t.title) like '%door%' or lower(t.title) like '%hardware%' or lower(t.title) like '%lock%' then 'Doors + hardware'
        else 'Venue buildout'
      end,
      'venue_model_normalized_at', now(),
      'venue_model_source', 'venue_room_objects_20260722'
    ),
    updated_at = now()
from venue, marshall
where t.farm_id = venue.farm_id
  and t.assigned_membership_id = marshall.id
  and t.status <> 'archived'
  and (
    t.task_type in ('marshall_bathroom', 'marshall_library', 'marshall_trim', 'marshall_floor')
    or lower(t.title) like '%acrylic white board%'
    or lower(t.title) like '%acrylic whiteboard%'
  );

-- Private residential work receives the existing Farmhouse Interior zone so it
-- stays separate from rentable-room work.
with farmhouse as (
  select z.farm_id, z.id as zone_id
  from atlas.zones z
  join atlas.farms f on f.id = z.farm_id
  where f.stable_key = 'elm_farm'
    and z.stable_key = 'farmhouse_interior'
), marshall as (
  select fm.id
  from atlas.farm_memberships fm
  join farmhouse on farmhouse.farm_id = fm.farm_id
  where fm.active = true
    and fm.worker_key = 'marshall'
  order by fm.created_at
  limit 1
)
update atlas.tasks t
set zone_id = farmhouse.zone_id,
    metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'collection_zone', 'Private House',
      'operational_area', 'Private House',
      'location_model_normalized_at', now(),
      'location_model_source', 'venue_room_objects_20260722'
    ),
    updated_at = now()
from farmhouse, marshall
where t.farm_id = farmhouse.farm_id
  and t.assigned_membership_id = marshall.id
  and t.status <> 'archived'
  and (
    lower(t.title) ~ '(basement|attic|dryer|pantry|entryway)'
    or lower(coalesce(t.note, '')) ~ '(basement|attic|dryer|pantry|entryway)'
  );

-- Attach room-specific tasks to the permanent room objects.
with room_tasks as (
  select t.id as task_id,
         case
           when lower(t.title) like '%venue bathroom%' or t.task_type in ('venue_signage', 'venue_windows') and lower(coalesce(t.note, '')) like '%venue bathroom%'
             then 'venue_bathroom'
           when lower(t.title) like '%library%'
             then 'venue_library'
           when lower(t.title) like '%oak plywood floor%'
             then 'venue_lounge'
           when lower(t.title) like '%acrylic white board%' or lower(t.title) like '%acrylic whiteboard%'
             then 'venue_conference_room'
           else null
         end as object_key
  from atlas.tasks t
  join atlas.farms f on f.id = t.farm_id
  join atlas.farm_memberships fm on fm.id = t.assigned_membership_id
  where f.stable_key = 'elm_farm'
    and fm.worker_key = 'marshall'
    and t.status <> 'archived'
), resolved as (
  select rt.task_id, go.id as object_id, rt.object_key
  from room_tasks rt
  join atlas.farms f on f.stable_key = 'elm_farm'
  join atlas.growing_objects go
    on go.farm_id = f.id
   and go.stable_key = rt.object_key
  where rt.object_key is not null
)
insert into atlas.task_objects (task_id, object_id, role)
select task_id, object_id, 'primary_space'
from resolved
on conflict (task_id, object_id) do update
set role = excluded.role;

-- Persist the room assignment in task metadata for readers that do not yet
-- inspect task_objects directly.
with room_assignment as (
  select t.id as task_id,
         go.stable_key as room_key,
         go.label as room_label,
         case
           when go.stable_key in ('venue_bathroom', 'venue_library') then 'high'
           when go.stable_key = 'venue_lounge' then 'high'
           else 'medium'
         end as confidence
  from atlas.tasks t
  join atlas.task_objects task_object on task_object.task_id = t.id
  join atlas.growing_objects go on go.id = task_object.object_id
  join atlas.farms f on f.id = t.farm_id
  where f.stable_key = 'elm_farm'
    and go.object_type = 'room'
)
update atlas.tasks t
set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
      'venue_room_key', assignment.room_key,
      'venue_room_label', assignment.room_label,
      'room_assignment_confidence', assignment.confidence,
      'room_assignment_source', 'venue_room_objects_20260722'
    ),
    updated_at = now()
from room_assignment assignment
where t.id = assignment.task_id;

-- Initialize room state from its current open task load. The room remains the
-- durable object after today's buildout tasks are complete.
with room_state as (
  select
    go.id as object_id,
    go.farm_id,
    count(t.id) filter (where t.status in ('open', 'blocked'))::integer as active_task_count
  from atlas.growing_objects go
  left join atlas.task_objects task_object on task_object.object_id = go.id
  left join atlas.tasks t on t.id = task_object.task_id
  join atlas.farms f on f.id = go.farm_id
  where f.stable_key = 'elm_farm'
    and go.object_type = 'room'
    and go.object_mode = 'rental_room'
  group by go.id, go.farm_id
)
insert into atlas.object_state (
  object_id,
  farm_id,
  life_status,
  presentability,
  active_task_count,
  decision_required,
  metadata
)
select
  object_id,
  farm_id,
  'active',
  case when active_task_count > 0 then 'work_in_progress' else 'not_assessed' end,
  active_task_count,
  false,
  jsonb_build_object(
    'rental_readiness', case when active_task_count > 0 then 'work_in_progress' else 'not_assessed' end,
    'booking_ready', false,
    'state_source', 'venue_room_objects_20260722'
  )
from room_state
on conflict (object_id) do update
set life_status = excluded.life_status,
    presentability = excluded.presentability,
    active_task_count = excluded.active_task_count,
    metadata = coalesce(atlas.object_state.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();
