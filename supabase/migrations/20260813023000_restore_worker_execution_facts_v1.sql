begin;

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'execution_how_label','Recipe',
      'execution_how',jsonb_build_array(
        'Put 2 cups coarsely ground coffee + 6 cups cold water in a clean half-gallon wide-mouth mason jar.',
        'Stir until all grounds are wet, cover, and refrigerate 12–16 hours.',
        'Tomorrow strain through a fine-mesh strainer lined with a coffee filter; do not squeeze the grounds.',
        'Serve strong over plenty of ice with water or milk to taste.'
      )
    ),
    updated_at=now()
where metadata->>'task_key'='anna_20260812_coffee_bar_start_cold_brew';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'checklist_sort_order',
      case metadata->>'task_key'
        when 'anna_20260812_coffee_bar_step_mix' then 1
        when 'anna_20260812_coffee_bar_step_stir' then 2
        when 'anna_20260812_coffee_bar_step_chill' then 3
      end
    ),
    updated_at=now()
where metadata->>'task_key' in (
  'anna_20260812_coffee_bar_step_mix',
  'anna_20260812_coffee_bar_step_stir',
  'anna_20260812_coffee_bar_step_chill'
);

commit;
