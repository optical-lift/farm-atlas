insert into atlas.object_map_frames(
  object_id,farm_id,long_axis,left_edge,right_edge,top_edge,bottom_edge,
  orientation_source,confidence,metadata
)
select
  go.id,go.farm_id,'north_south','north','south','west','east',
  case
    when go.stable_key ~ '^fr_[0-9]+$' then 'elm_field_row_registry'
    when go.stable_key ~ '^bb_[0-9]+$' then 'elm_barn_bed_registry'
    else 'elm_u_pick_registry'
  end,
  'high',
  jsonb_build_object('display_rule','long_axis_horizontal','map_origin','left_edge')
from atlas.growing_objects go
where go.stable_key ~ '^fr_[0-9]+$'
   or go.stable_key ~ '^bb_[0-9]+$'
   or go.stable_key ~ '^u_pick_(bed|walkway)_[0-9]+$'
   or go.stable_key='u_pick_middle_partition'
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

insert into atlas.object_map_frames(
  object_id,farm_id,long_axis,left_edge,right_edge,top_edge,bottom_edge,
  orientation_source,confidence,metadata
)
select
  go.id,go.farm_id,'unknown',null,null,null,null,
  'orientation_not_yet_mapped','low',
  jsonb_build_object('display_rule','long_axis_horizontal','map_origin','unknown')
from atlas.weed_cards wc
join atlas.growing_objects go on go.id=wc.object_id
left join atlas.object_map_frames frame on frame.object_id=go.id
where frame.object_id is null
on conflict (object_id) do nothing;

update atlas.crop_placements cp
set long_start_ft=0,
    long_end_ft=go.length_ft,
    position_confidence='high',
    metadata=coalesce(cp.metadata,'{}'::jsonb)||jsonb_build_object(
      'position_source','full_row_equals_recorded_bed_length'
    ),
    updated_at=now()
from atlas.growing_objects go
where cp.object_id=go.id
  and cp.placement_mode='full_rows'
  and go.length_ft is not null
  and cp.row_length_ft is not null
  and abs(cp.row_length_ft-go.length_ft)<=0.25
  and cp.long_start_ft is null
  and cp.long_end_ft is null;
