begin;

update atlas.resources r
set
  resource_category = 'container',
  metadata = r.metadata || jsonb_build_object(
    'task_move_requirement_kind', 'container',
    'category_aligned_at', now()
  ),
  updated_at = now()
from atlas.farms f
where r.farm_id = f.id
  and f.stable_key = 'elm_farm'
  and r.stable_key in ('pot_up_tray_200_cell', 'pot_up_tray_120_cell');

commit;
