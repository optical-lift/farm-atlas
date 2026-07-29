create table if not exists atlas.object_map_frames (
  object_id uuid primary key references atlas.growing_objects(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  long_axis text not null check (long_axis in ('north_south','east_west','unknown')),
  left_edge text check (left_edge in ('north','south','east','west')),
  right_edge text check (right_edge in ('north','south','east','west')),
  top_edge text check (top_edge in ('north','south','east','west')),
  bottom_edge text check (bottom_edge in ('north','south','east','west')),
  orientation_source text not null default 'unknown',
  confidence text not null default 'medium' check (confidence in ('low','medium','high')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (long_axis='north_south' and left_edge in ('north','south') and right_edge in ('north','south') and left_edge<>right_edge)
    or (long_axis='east_west' and left_edge in ('east','west') and right_edge in ('east','west') and left_edge<>right_edge)
    or long_axis='unknown'
  )
);

alter table atlas.crop_placements
  add column if not exists anchor_edge text check (anchor_edge in ('north','south','east','west')),
  add column if not exists long_start_ft numeric check (long_start_ft is null or long_start_ft>=0),
  add column if not exists long_end_ft numeric check (long_end_ft is null or long_end_ft>=0),
  add column if not exists cross_start_ft numeric check (cross_start_ft is null or cross_start_ft>=0),
  add column if not exists cross_end_ft numeric check (cross_end_ft is null or cross_end_ft>=0),
  add column if not exists position_confidence text not null default 'unknown' check (position_confidence in ('unknown','low','medium','high'));

create index if not exists object_map_frames_farm_idx on atlas.object_map_frames(farm_id);
create index if not exists crop_placements_anchor_edge_idx on atlas.crop_placements(object_id,anchor_edge);

insert into atlas.object_map_frames(
  object_id,farm_id,long_axis,left_edge,right_edge,top_edge,bottom_edge,
  orientation_source,confidence,metadata
)
select
  go.id,go.farm_id,'north_south','north','south','west','east',
  'owner_confirmed_2026_07_29','high',
  jsonb_build_object('display_rule','long_axis_horizontal','map_origin','left_edge')
from atlas.growing_objects go
where go.stable_key ~ '^eb_sunflower_[0-9]+$'
on conflict (object_id) do update
set long_axis=excluded.long_axis,
    left_edge=excluded.left_edge,
    right_edge=excluded.right_edge,
    top_edge=excluded.top_edge,
    bottom_edge=excluded.bottom_edge,
    orientation_source=excluded.orientation_source,
    confidence=excluded.confidence,
    metadata=atlas.object_map_frames.metadata||excluded.metadata,
    updated_at=now();

update atlas.crop_placements cp
set anchor_edge='north',
    long_start_ft=0,
    long_end_ft=3,
    cross_start_ft=0,
    cross_end_ft=3,
    position_confidence='high',
    placement_label='north 3 ft edge',
    metadata=coalesce(cp.metadata,'{}'::jsonb)||jsonb_build_object(
      'position_source','owner_confirmed_2026_07_29',
      'map_note','North 3 ft edge of EB7'
    ),
    updated_at=now()
from atlas.growing_objects go
join atlas.crop_cycles cc on cc.object_id=go.id
where cp.object_id=go.id
  and cp.crop_cycle_id=cc.id
  and go.stable_key='eb_sunflower_7'
  and lower(cc.crop_label) in ('iris','bearded iris','lemon balm','yarrow','salvia');

create or replace function atlas.object_crop_bed_map_v1(p_object_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,atlas
as $$
declare
  v_object atlas.growing_objects%rowtype;
  v_frame atlas.object_map_frames%rowtype;
  v_role text;
  v_rows jsonb;
begin
  select * into v_object from atlas.growing_objects where id=p_object_id;
  if v_object.id is null then raise exception 'Growing object not found.' using errcode='P0002'; end if;

  v_role:=atlas.current_farm_role(v_object.farm_id);
  if not atlas.is_farm_owner(v_object.farm_id) and coalesce(v_role,'') not in ('farm_hand','manager') then
    raise exception 'Bed map is not available to the signed-in farm member.' using errcode='42501';
  end if;

  select * into v_frame from atlas.object_map_frames where object_id=v_object.id;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'placementId',q.placement_id,
    'cropCycleId',q.crop_cycle_id,
    'displayLabel',q.display_label,
    'stage',q.stage,
    'stageLabel',atlas.crop_stage_label_v1(q.stage),
    'lifeCycle',case when q.is_perennial then 'perennial' else coalesce(q.life_cycle,'annual') end,
    'placementMode',q.placement_mode,
    'placementLabel',q.placement_label,
    'rowCount',q.row_count,
    'rowLengthFt',q.row_length_ft,
    'areaSqft',q.area_sqft,
    'explicitPlantCount',q.explicit_plant_count,
    'clumpCount',q.clump_count,
    'expectedQuantity',q.expected_quantity,
    'expectedQuantityKind',q.expected_quantity_kind,
    'observedQuantity',q.observed_quantity,
    'observedQuantityUnit',q.observed_quantity_unit,
    'standPercent',q.stand_percent,
    'anchorEdge',q.anchor_edge,
    'longStartFt',q.long_start_ft,
    'longEndFt',q.long_end_ft,
    'crossStartFt',q.cross_start_ft,
    'crossEndFt',q.cross_end_ft,
    'positionConfidence',q.position_confidence
  )) order by q.anchor_edge nulls last,q.display_label,q.crop_cycle_id),'[]'::jsonb)
  into v_rows
  from (
    select
      p.id placement_id,cc.id crop_cycle_id,
      case
        when lower(cc.crop_label)='sunflower' and nullif(btrim(coalesce(cc.variety,'')),'') is not null then btrim(cc.variety)||' sunflower'
        when lower(cc.crop_label) in ('bearded iris','iris') then 'Iris'
        else cc.crop_label
      end display_label,
      coalesce(obs.stage,atlas.crop_stage_from_state_v1(cc.cycle_state,cp.life_cycle)) stage,
      (lower(coalesce(cp.life_cycle,''))='perennial' or p.placement_mode in ('edge_strip','clumps') and lower(cc.crop_label) in ('iris','bearded iris','lemon balm','yarrow','salvia')) is_perennial,
      cp.life_cycle,p.placement_mode,p.placement_label,p.row_count,p.row_length_ft,p.area_sqft,
      p.explicit_plant_count,p.clump_count,p.expected_quantity,p.expected_quantity_kind,
      obs.observed_quantity,obs.quantity_unit observed_quantity_unit,obs.stand_percent,
      p.anchor_edge,p.long_start_ft,p.long_end_ft,p.cross_start_ft,p.cross_end_ft,p.position_confidence
    from atlas.crop_cycles cc
    left join atlas.crop_profiles cp on cp.id=cc.crop_profile_id
    left join lateral (
      select p0.* from atlas.crop_placements p0
      where p0.crop_cycle_id=cc.id
      order by (p0.position_confidence='high') desc,(p0.expected_quantity_kind='recorded') desc,p0.created_at
      limit 1
    ) p on true
    left join lateral (
      select o.stage,o.observed_quantity,o.quantity_unit,o.stand_percent
      from atlas.crop_observations o
      where o.crop_cycle_id=cc.id
      order by o.observed_date desc nulls last,o.created_at desc
      limit 1
    ) obs on true
    where cc.object_id=p_object_id
      and cc.lifecycle_status='active'
      and coalesce(obs.stage,atlas.crop_stage_from_state_v1(cc.cycle_state,cp.life_cycle),'unknown')
          not in ('cleared','failed','dead','absent','abandoned','archived','removed','inactive')
  ) q;

  return jsonb_build_object(
    'objectId',v_object.id,
    'objectKey',v_object.stable_key,
    'objectLabel',v_object.label,
    'lengthFt',v_object.length_ft,
    'widthFt',v_object.width_ft,
    'orientationKnown',v_frame.object_id is not null and v_frame.long_axis<>'unknown',
    'longAxis',coalesce(v_frame.long_axis,'unknown'),
    'leftEdge',v_frame.left_edge,
    'rightEdge',v_frame.right_edge,
    'topEdge',v_frame.top_edge,
    'bottomEdge',v_frame.bottom_edge,
    'orientationSource',v_frame.orientation_source,
    'placements',coalesce(v_rows,'[]'::jsonb)
  );
end;
$$;

revoke all on function atlas.object_crop_bed_map_v1(uuid) from public;
grant execute on function atlas.object_crop_bed_map_v1(uuid) to authenticated,service_role;

alter table atlas.object_map_frames enable row level security;

drop policy if exists object_map_frames_read on atlas.object_map_frames;
create policy object_map_frames_read on atlas.object_map_frames
for select to authenticated
using (atlas.is_farm_owner(farm_id) or atlas.current_farm_role(farm_id) in ('farm_hand','manager'));
