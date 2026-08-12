-- Keep the Owner's browse/reset analysis on the canonical task, but make the
-- Farm Hand execution packet literal. Deer protection is now a separate crop-
-- protection system and must never be represented as vague optional prose here.

do $block$
declare
  v_task atlas.tasks%rowtype;
begin
  select task.* into v_task
  from atlas.tasks task
  where task.metadata->>'task_key'='owner_20260808_sow_procut_horizon_bw7_bw8'
  order by task.created_at desc
  limit 1;

  if v_task.id is null then
    raise exception 'ProCut Horizon BW7/BW8 task is missing; refusing worker execution normalization.';
  end if;

  if v_task.task_type<>'sowing' or coalesce(v_task.action_key,'')<>'sow' then
    raise exception 'ProCut Horizon BW7/BW8 operation identity drifted; refusing worker execution normalization.';
  end if;

  if coalesce((v_task.metadata->>'rows_per_3ft_bed')::numeric,-1)<>3
     or coalesce((v_task.metadata->>'in_row_spacing_in')::numeric,-1)<>4 then
    raise exception 'ProCut Horizon BW7/BW8 spacing truth drifted; refusing worker execution normalization.';
  end if;

  update atlas.tasks task
  set metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_title','Sow ProCut Horizon · BW7 + BW8',
        'display_action','Sow',
        'display_subject','ProCut Horizon',
        'display_location','Berry Walk Flower Rows · BW7 + BW8',
        'execution_do','Sow ProCut Horizon in Berry Walk Flower Rows, beds BW7 and BW8.',
        'execution_place','Berry Walk Flower Rows · BW7 + BW8',
        'execution_how',jsonb_build_array(
          'Use 3 rows per bed.',
          'Sow at 4-inch spacing within each row.'
        ),
        'worker_result_label','Next',
        'worker_result_lines',jsonb_build_array('Germination watch begins from the recorded sow date.'),
        'deer_protection_relevant',true,
        'worker_execution_normalized_at',now(),
        'worker_execution_normalized_source','worker_task_contract_correction_v1'
      ),
      updated_at=now()
  where task.id=v_task.id;
end;
$block$;
