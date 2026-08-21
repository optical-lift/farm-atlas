create or replace function atlas.ensure_weekly_harvest_card_v1(p_farm_id uuid,p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_member atlas.farm_memberships%rowtype;
  v_existing atlas.tasks%rowtype;
  v_occurrence uuid;
  v_materialized jsonb;
  v_task_id uuid;
  v_season_end date:=date '2026-11-12';
begin
  if p_farm_id is null or p_due_date is null then raise exception 'Farm and Harvest service date are required.' using errcode='22023'; end if;
  if extract(isodow from p_due_date)::integer<>4 then raise exception 'Weekly Harvest is a Thursday card.' using errcode='22023'; end if;
  if p_due_date>v_season_end then return jsonb_build_object('state','outside_season','dueDate',p_due_date); end if;

  select * into v_member from atlas.farm_memberships where farm_id=p_farm_id and active and worker_key='anna' order by created_at limit 1;
  if v_member.id is null then return jsonb_build_object('state','anna_membership_missing','dueDate',p_due_date); end if;

  select * into v_existing from atlas.tasks where farm_id=p_farm_id and task_series_key='anna_harvest_thursday_weekly' and due_date=p_due_date and status<>'archived' order by created_at limit 1;
  if v_existing.id is not null then
    update atlas.tasks
    set title='Harvest Stems',task_type='harvest',action_key='harvest',
        visibility_scope=case when status in ('open','blocked') then 'assigned_worker' else visibility_scope end,
        assigned_membership_id=case when status in ('open','blocked') then v_member.id else assigned_membership_id end,
        assigned_user_id=case when status in ('open','blocked') then v_member.user_id else assigned_user_id end,
        metadata=(coalesce(metadata,'{}'::jsonb)-'visibility_suspended_at'-'visibility_suspended_by'-'visibility_suspend_reason'-'visibility_scope_before_suspend')
          ||jsonb_build_object('task_style','weekly_harvest_round','weekly_routine',true,'repeat_rule','weekly','repeat_weekday','Thursday','display_action','Harvest stems','display_subject','Stems',
            'display_location','Elm Farm','collection_zone','Elm Farm','work_route','harvest','structured_result_required',true,'result_contract','weekly_harvest_round_v1',
            'crop_rows_derived_from_domain_truth',true,'standalone_harvest_tasks_forbidden',true,'season_end',v_season_end::text),
        updated_at=now()
    where id=v_existing.id;
    return jsonb_build_object('state','kept_current','taskId',v_existing.id,'occurrenceId',v_existing.planned_occurrence_id,'dueDate',p_due_date);
  end if;

  v_occurrence:=atlas.plan_fixed_assigned_worker_occurrence_v1(
    p_farm_id=>p_farm_id,p_membership_id=>v_member.id,p_user_id=>v_member.user_id,
    p_definition_key=>'anna_harvest_thursday_weekly_2026',p_policy_key=>'anna_harvest_thursday_weekly_2026:release',
    p_occurrence_key=>'recurring:anna_harvest_thursday_weekly:'||p_due_date::text,p_title=>'Harvest Stems',p_task_type=>'harvest',p_due_date=>p_due_date,
    p_priority=>'high',p_action_key=>'harvest',p_series_key=>'anna_harvest_thursday_weekly',p_effort_units=>1,
    p_metadata=>jsonb_build_object('task_style','weekly_harvest_round','weekly_routine',true,'repeat_rule','weekly','repeat_weekday','Thursday','display_action','Harvest stems','display_subject','Stems',
      'display_location','Elm Farm','collection_zone','Elm Farm','structured_result_required',true,'result_contract','weekly_harvest_round_v1','crop_rows_derived_from_domain_truth',true,
      'standalone_harvest_tasks_forbidden',true,'season_end',v_season_end::text)
  );
  update atlas.planned_work_occurrences set title='Harvest Stems',task_payload=jsonb_set(task_payload,'{title}',to_jsonb('Harvest Stems'::text),true),updated_at=now() where id=v_occurrence;
  if p_due_date<=(now() at time zone 'America/Chicago')::date then
    v_materialized:=atlas.materialize_specific_work_occurrence_v1(v_occurrence,(now() at time zone 'America/Chicago')::date);
    begin v_task_id:=nullif(v_materialized->>'taskId','')::uuid; exception when others then v_task_id:=null; end;
  end if;
  return jsonb_build_object('state',case when v_task_id is null then 'planned' else 'released' end,'taskId',v_task_id,'occurrenceId',v_occurrence,'dueDate',p_due_date);
end;
$function$;

update atlas.work_definitions set title_template='Harvest Stems',updated_at=now()
where farm_id=(select id from atlas.farms where stable_key='elm_farm') and stable_key='anna_harvest_thursday_weekly_2026';

update atlas.planned_work_occurrences
set title='Harvest Stems',task_payload=jsonb_set(task_payload,'{title}',to_jsonb('Harvest Stems'::text),true),updated_at=now()
where farm_id=(select id from atlas.farms where stable_key='elm_farm') and occurrence_key like 'recurring:anna_harvest_thursday_weekly:%' and state in ('planned','eligible','failed','releasing');
