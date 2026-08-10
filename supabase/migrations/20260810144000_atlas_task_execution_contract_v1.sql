begin;

-- The execution surface reads one worker-facing contract: do / place / how / done when.
-- Preserve long notes as reference material rather than promoting them into task headings.

update atlas.tasks
set title = 'Check fall spinach starts',
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'legacy_execution_title', coalesce(metadata ->> 'legacy_execution_title', title),
        'display_title', 'Check fall spinach starts',
        'execution_contract_version', 'do_place_how_done_v1',
        'execution_do', 'Check fall spinach starts',
        'execution_place', 'Grow Room · Outside hardening area',
        'execution_how', jsonb_build_array('Check that the starts are rooted and sturdy enough to hold until EB1–EB6 are cleared Aug 17.'),
        'execution_done_when', 'Record how many seedlings are transplant-ready, or record that none survived.'
      ),
    updated_at = now()
where metadata ->> 'task_key' = 'germination_harvest_watch_202d2e89-71b5-4107-a266-886b8a6ca1ab';

update atlas.tasks
set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'execution_contract_version', 'do_place_how_done_v1',
        'execution_do', 'Call for free wood-chip / weed-suppression sources',
        'execution_place', 'Marshfield / local disposal routes',
        'execution_how', jsonb_build_array('Call local tree services, city crews, and wood businesses. Use the call list and script below.'),
        'execution_done_when', 'Record each contact’s material, cost or free status, load size, delivery or pickup, and timing.'
      ),
    updated_at = now()
where metadata ->> 'task_key' = 'anna_20260810_find_free_woodchips_weed_suppression';

update atlas.tasks
set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'execution_contract_version', 'do_place_how_done_v1',
        'execution_do', 'Pot up Snow in Summer',
        'execution_place', 'Grow Room · 200-cell Pot Up',
        'execution_how', jsonb_build_array('Pot up 4 trays: 200, 200, 200, and 120 plants.'),
        'execution_done_when', 'All 4 trays are potted up.'
      ),
    updated_at = now()
where metadata ->> 'task_key' = 'anna_20260810_pot_up_200_cell_snow_in_summer_tray_1';

update atlas.tasks
set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'execution_contract_version', 'do_place_how_done_v1',
        'execution_do', 'Sow ProCut Horizon',
        'execution_place', 'Berry Walk Flower Rows · Beds 7–8',
        'execution_how', jsonb_build_array('3 rows per bed · 4″ spacing.', 'Protect the new succession from deer if a practical method is available.'),
        'execution_done_when', 'Berry Walk Beds 7 and 8 are sown.'
      ),
    updated_at = now()
where metadata ->> 'task_key' = 'owner_20260808_sow_procut_horizon_bw7_bw8';

update atlas.tasks
set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'execution_contract_version', 'do_place_how_done_v1',
        'execution_do', 'Mow Field Rows · Back Half',
        'execution_place', 'Field Rows · Back Half',
        'execution_how', jsonb_build_array('Riding mower · cut to 4 in.'),
        'execution_done_when', 'The whole Field Rows · Back Half route is cut to 4 in.'
      ),
    updated_at = now()
where metadata ->> 'mowing_route_key' = 'mowing_field_rows_back_half';

commit;
