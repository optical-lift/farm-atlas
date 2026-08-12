begin;

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Snow in Summer','display_subject','Snow in Summer'),updated_at=now()
where metadata->>'task_key'='anna_20260810_pot_up_200_cell_snow_in_summer_tray_1';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','MG11','display_subject','MG11'),updated_at=now()
where title='Weed MG11' and status in ('open','blocked');

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','ProCut Horizon · BW7 + BW8','display_subject','ProCut Horizon · BW7 + BW8'),updated_at=now()
where metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Chickens · Feed, water + eggs','display_subject','Chickens · Feed, water + eggs','display_family','Tend'),updated_at=now()
where metadata->>'task_key'='anna_chicken_chore_20260812';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Café lights + porch solar lights','display_subject','Café lights + porch solar lights'),updated_at=now()
where title='Hang conference-room café lights + porch solar lights' and due_date=date '2026-08-12';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Elm Farm · Weekly harvest','display_subject','Elm Farm · Weekly harvest'),updated_at=now()
where metadata->>'task_key'='anna_harvest_thursday_weekly_20260813';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','School + preschool enrollment','display_subject','School + preschool enrollment'),updated_at=now()
where metadata->>'task_key'='anna_20260805_school_preschool_enrollment';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Coffee + wrapping supplies','display_subject','Coffee + wrapping supplies','display_action','Prepare'),updated_at=now()
where metadata->>'task_key'='anna_20260812_prep_bloom_bar_coffee_wrapping';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Mowing areas · Sticks + hoses','display_subject','Mowing areas · Sticks + hoses','display_action','Prepare'),updated_at=now()
where metadata->>'task_key'='yard_stick_pickup_before_wednesday_mowing';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
  'display_subject',case metadata->>'task_key'
    when 'anna_florist_wholesale_batch_1_20260810' then 'Florist buyers · Batch 1'
    when 'anna_20260810_find_free_woodchips_weed_suppression' then 'Free wood-chip sources'
    when 'anna_restaurant_bud_vase_outreach_batch_1' then 'Restaurants · Weekly bud vases'
    when 'network_20260725_call_10_churches' then 'Church groups · Thursdays at Elm'
    when 'anna_florist_wholesale_batch_2_20260817' then 'Florist buyers · Batch 2'
    when 'anna_florist_wholesale_batch_3_20260824' then 'Florist buyers · Batch 3'
    when 'anna_florist_wholesale_batch_4_20260831' then 'Florist buyers · Batch 4'
    when 'anna_florist_wholesale_batch_5_20260907' then 'Florist buyers · Batch 5'
  end,
  'display_title',case metadata->>'task_key'
    when 'anna_florist_wholesale_batch_1_20260810' then 'Florist buyers · Batch 1'
    when 'anna_20260810_find_free_woodchips_weed_suppression' then 'Free wood-chip sources'
    when 'anna_restaurant_bud_vase_outreach_batch_1' then 'Restaurants · Weekly bud vases'
    when 'network_20260725_call_10_churches' then 'Church groups · Thursdays at Elm'
    when 'anna_florist_wholesale_batch_2_20260817' then 'Florist buyers · Batch 2'
    when 'anna_florist_wholesale_batch_3_20260824' then 'Florist buyers · Batch 3'
    when 'anna_florist_wholesale_batch_4_20260831' then 'Florist buyers · Batch 4'
    when 'anna_florist_wholesale_batch_5_20260907' then 'Florist buyers · Batch 5'
  end
),updated_at=now()
where metadata->>'task_key' in (
  'anna_florist_wholesale_batch_1_20260810','anna_20260810_find_free_woodchips_weed_suppression','anna_restaurant_bud_vase_outreach_batch_1','network_20260725_call_10_churches','anna_florist_wholesale_batch_2_20260817','anna_florist_wholesale_batch_3_20260824','anna_florist_wholesale_batch_4_20260831','anna_florist_wholesale_batch_5_20260907'
);

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Karianne’s garden · 7 buckets','display_subject','Karianne’s garden · 7 buckets'),updated_at=now()
where title='Thursday morning harvest at Karianne’s garden for bouquet bar' and due_date=date '2026-08-13';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Thursday flower buckets','display_subject','Thursday flower buckets'),updated_at=now()
where title='Condition + sort Thursday flower buckets' and due_date=date '2026-08-13';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Bouquet flowers','display_subject','Bouquet flowers'),updated_at=now()
where title='Display bouquet flowers for guests' and due_date=date '2026-08-13';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Finished bouquets · Guest pickup','display_subject','Finished bouquets · Guest pickup'),updated_at=now()
where title='Stage finished bouquets for pickup' and due_date=date '2026-08-13';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Bathroom door · Under construction sign','display_subject','Bathroom door · Under construction sign'),updated_at=now()
where title='Post bathroom under-construction sign' and due_date=date '2026-08-13';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Guest parking · Red + white posts','display_subject','Guest parking · Red + white posts','display_action','Mark'),updated_at=now()
where metadata->>'task_key'='anna_20260813_set_bouquet_bar_parking_posts';

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('display_title','Walmart · Event pickup','display_subject','Walmart · Event pickup'),updated_at=now()
where metadata->>'task_key'='anna_20260812_walmart_event_pickup';

commit;
