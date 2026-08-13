begin;

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'display_subject','ProCut Horizon · BW7 + BW8',
      'detail_heading','Timing forecast',
      'detail_lines',jsonb_build_array(
        'Projected germination · Aug 16–Aug 22',
        'Projected harvest · Oct 1–Oct 11',
        'Projected clear bed · Oct 16'
      ),
      'worker_result_lines',jsonb_build_array(
        'Germination watch begins from the recorded sow date.'
      )
    ),
    updated_at=now()
where metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8';

commit;
