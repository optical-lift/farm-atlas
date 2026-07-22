-- Map existing outdoor work to durable Atlas objects and add Mailbox as a light weeding cycle.

with elm as (
  select id from atlas.farms where stable_key = 'elm_farm'
)
update atlas.growing_objects go
set label = 'South Perennial Garden',
    metadata = coalesce(go.metadata, '{}'::jsonb) || jsonb_build_object(
      'canonical_name', 'South Perennial Garden',
      'former_label', go.label,
      'canonicalized_at', now(),
      'canonicalized_source', 'owner_instruction_20260722'
    ),
    updated_at = now()
from elm
where go.farm_id = elm.id
  and go.stable_key = 'house_south_foundation_border_west';

with elm as (
  select id from atlas.farms where stable_key = 'elm_farm'
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
  'parking_arrival',
  'Parking and Arrival Areas',
  'arrival',
  'guest_arrival',
  'Keep parking, arrival landmarks, and the first guest approach clear and presentable.',
  'active',
  true,
  5,
  jsonb_build_object(
    'source', 'owner_instruction_20260722',
    'guest_facing', true,
    'operating_model', 'arrival_first'
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

with elm as (
  select id from atlas.farms where stable_key = 'elm_farm'
), object_seed(stable_key, label, zone_key, object_type, object_mode, guest_visible, sort_order, metadata) as (
  values
    (
      'detached_garage_trading_post',
      'Detached Garage / The Trading Post',
      'venue',
      'area',
      'venue_structure',
      true,
      70,
      jsonb_build_object(
        'source', 'owner_instruction_20260722',
        'current_use', 'detached_garage',
        'future_use', 'trading_post',
        'guest_facing', true,
        'is_growing_space', false
      )
    ),
    (
      'oasis_by_pool',
      'Oasis by the Pool',
      'oasis',
      'area',
      'venue_landscape',
      true,
      10,
      jsonb_build_object(
        'source', 'owner_instruction_20260722',
        'guest_facing', true,
        'operational_role', 'pool_boundary_and_guest_access',
        'is_growing_space', false
      )
    ),
    (
      'mailbox',
      'Mailbox',
      'parking_arrival',
      'area',
      'arrival_landmark',
      true,
      10,
      jsonb_build_object(
        'source', 'owner_instruction_20260722',
        'guest_facing', true,
        'operational_role', 'arrival_landmark',
        'is_growing_space', false
      )
    )
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
  elm.id,
  z.id,
  seed.stable_key,
  seed.label,
  seed.object_type,
  seed.object_mode,
  seed.guest_visible,
  seed.sort_order,
  seed.metadata
from elm
join object_seed seed on true
join atlas.zones z
  on z.farm_id = elm.id
 and z.stable_key = seed.zone_key
on conflict (farm_id, stable_key) do update
set zone_id = excluded.zone_id,
    label = excluded.label,
    object_type = excluded.object_type,
    object_mode = excluded.object_mode,
    guest_visible = excluded.guest_visible,
    sort_order = excluded.sort_order,
    metadata = coalesce(atlas.growing_objects.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with elm as (
  select id from atlas.farms where stable_key = 'elm_farm'
), mappings(title, zone_key, object_key, task_type, action_key, operational_area, category_key, category_label, work_rhythm) as (
  values
    (
      'Marshall — Cut Down Redbuds in Janice Garden',
      'farmhouse_south_landscape',
      'house_south_foundation_border_west',
      'grounds_tree_work',
      'tree_removal',
      'South Perennial Garden',
      'tree_removal',
      'Tree removal',
      'Grounds Maintenance'
    ),
    (
      'Marshall — Cut Down Tree Along Detached Garage Siding',
      'venue',
      'detached_garage_trading_post',
      'grounds_tree_work',
      'tree_removal',
      'Detached Garage / The Trading Post',
      'tree_removal',
      'Tree removal',
      'Grounds Maintenance'
    ),
    (
      'Marshall — Mow/Clear Beside Chicken Coop',
      'chicken_coop',
      'chicken_coop_main',
      'grounds_mowing',
      'mow',
      'Chicken Coop',
      'mowing_grounds',
      'Outdoor mowing + grounds',
      'Grounds Maintenance'
    ),
    (
      'Marshall — Install Lattice and Pool Gate',
      'oasis',
      'oasis_by_pool',
      'venue_access_boundary',
      'venue',
      'Oasis by the Pool',
      'boundary_guest_access',
      'Boundary + guest access',
      'Outdoor Venue Work'
    )
), resolved as (
  select
    t.id as task_id,
    z.id as zone_id,
    m.object_key,
    m.task_type,
    m.action_key,
    m.operational_area,
    m.category_key,
    m.category_label,
    m.work_rhythm
  from elm
  join mappings m on true
  join atlas.tasks t
    on t.farm_id = elm.id
   and t.title = m.title
   and t.status <> 'archived'
  join atlas.zones z
    on z.farm_id = elm.id
   and z.stable_key = m.zone_key
)
update atlas.tasks t
set zone_id = r.zone_id,
    task_type = r.task_type,
    action_key = r.action_key,
    metadata = (
      coalesce(t.metadata, '{}'::jsonb)
      - 'venue_room_key'
      - 'venue_room_label'
      - 'room_assignment_confidence'
      - 'room_assignment_source'
    ) || jsonb_build_object(
      'work_route', r.action_key,
      'work_rhythm', r.work_rhythm,
      'collection_zone', r.operational_area,
      'operational_area', r.operational_area,
      'work_category_key', r.category_key,
      'work_category_label', r.category_label,
      'location_model_normalized_at', now(),
      'location_model_source', 'owner_instruction_20260722'
    ),
    updated_at = now()
from resolved r
where t.id = r.task_id;

with elm as (
  select id from atlas.farms where stable_key = 'elm_farm'
), mappings(title, object_key) as (
  values
    ('Marshall — Cut Down Redbuds in Janice Garden', 'house_south_foundation_border_west'),
    ('Marshall — Cut Down Tree Along Detached Garage Siding', 'detached_garage_trading_post'),
    ('Marshall — Mow/Clear Beside Chicken Coop', 'chicken_coop_main'),
    ('Marshall — Install Lattice and Pool Gate', 'oasis_by_pool')
), resolved as (
  select t.id as task_id, go.id as object_id
  from elm
  join mappings m on true
  join atlas.tasks t
    on t.farm_id = elm.id
   and t.title = m.title
   and t.status <> 'archived'
  join atlas.growing_objects go
    on go.farm_id = elm.id
   and go.stable_key = m.object_key
)
insert into atlas.task_objects (task_id, object_id, role)
select task_id, object_id, 'target'
from resolved
on conflict (task_id, object_id) do update
set role = excluded.role;

with elm as (
  select id from atlas.farms where stable_key = 'elm_farm'
), target_objects as (
  select go.id as object_id, go.farm_id, go.stable_key
  from atlas.growing_objects go
  join elm on elm.id = go.farm_id
  where go.stable_key in (
    'house_south_foundation_border_west',
    'detached_garage_trading_post',
    'oasis_by_pool',
    'mailbox',
    'chicken_coop_main'
  )
), task_counts as (
  select
    tx.object_id,
    count(*) filter (where t.status in ('open', 'blocked'))::integer as active_task_count
  from atlas.task_objects tx
  join atlas.tasks t on t.id = tx.task_id
  where tx.object_id in (select object_id from target_objects)
  group by tx.object_id
)
insert into atlas.object_state (
  object_id,
  farm_id,
  life_status,
  weed_pressure,
  water_status,
  decision_required,
  harvest_confidence,
  presentability,
  active_task_count,
  metadata
)
select
  o.object_id,
  o.farm_id,
  'open',
  case when o.stable_key = 'mailbox' then 'low' else 'unknown' end,
  'unknown',
  false,
  'unknown',
  case when o.stable_key = 'mailbox' then 'needs_attention' else 'unknown' end,
  coalesce(tc.active_task_count, 0),
  jsonb_build_object(
    'source', 'owner_instruction_20260722',
    'object_stable_key', o.stable_key
  )
from target_objects o
left join task_counts tc on tc.object_id = o.object_id
on conflict (object_id) do update
set active_task_count = excluded.active_task_count,
    metadata = coalesce(atlas.object_state.metadata, '{}'::jsonb) || excluded.metadata,
    weed_pressure = case
      when excluded.metadata ->> 'object_stable_key' = 'mailbox' then 'low'
      else atlas.object_state.weed_pressure
    end,
    presentability = case
      when excluded.metadata ->> 'object_stable_key' = 'mailbox' then 'needs_attention'
      else atlas.object_state.presentability
    end,
    updated_at = now();

with elm as (
  select id from atlas.farms where stable_key = 'elm_farm'
), mailbox as (
  select go.id as object_id, go.farm_id, go.zone_id
  from atlas.growing_objects go
  join elm on elm.id = go.farm_id
  where go.stable_key = 'mailbox'
)
insert into atlas.maintenance_objects (
  farm_id,
  zone_id,
  object_id,
  maintenance_type,
  condition,
  reset_effort_minutes,
  maintenance_effort_minutes,
  current_effort_minutes,
  remaining_effort_minutes,
  normal_return_interval_days,
  last_completed_at,
  next_eligible_date,
  priority_score,
  must_precede_task,
  guest_facing,
  crop_protective,
  revenue_linked,
  routine,
  owner_priority,
  active,
  source,
  metadata,
  crop_loss_risk,
  revenue_unlock_score,
  planting_block_score,
  guest_visibility_score,
  weed_spread_risk,
  upcoming_booking_score,
  estimate_source
)
select
  mailbox.farm_id,
  mailbox.zone_id,
  mailbox.object_id,
  'weed',
  'maintained',
  20,
  10,
  10,
  10,
  90,
  null,
  current_date,
  0,
  false,
  true,
  false,
  false,
  true,
  0,
  true,
  'owner_instruction_20260722',
  jsonb_build_object(
    'object_stable_key', 'mailbox',
    'zone_stable_key', 'parking_arrival',
    'collection_label', 'Mailbox',
    'work_collection_key', 'weeding',
    'light_maintenance_pass', true,
    'priority_reason', 'Guest-visible arrival landmark',
    'return_interval_source', 'owner_instruction_20260722'
  ),
  0,
  0,
  0,
  35,
  10,
  0,
  'owner_light_weeding'
from mailbox
on conflict (object_id, maintenance_type) do update
set zone_id = excluded.zone_id,
    condition = excluded.condition,
    reset_effort_minutes = excluded.reset_effort_minutes,
    maintenance_effort_minutes = excluded.maintenance_effort_minutes,
    current_effort_minutes = excluded.current_effort_minutes,
    remaining_effort_minutes = excluded.remaining_effort_minutes,
    normal_return_interval_days = excluded.normal_return_interval_days,
    next_eligible_date = excluded.next_eligible_date,
    guest_facing = excluded.guest_facing,
    routine = excluded.routine,
    active = excluded.active,
    source = excluded.source,
    metadata = coalesce(atlas.maintenance_objects.metadata, '{}'::jsonb) || excluded.metadata,
    guest_visibility_score = excluded.guest_visibility_score,
    weed_spread_risk = excluded.weed_spread_risk,
    estimate_source = excluded.estimate_source,
    updated_at = now();
