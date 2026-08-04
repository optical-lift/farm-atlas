-- Keep BB10 unavailable until three Bermuda-grass treatments and a readiness check are complete.

begin;

do $migration$
declare
  v_farm_id uuid;
  v_zone_id uuid;
  v_owner_membership_id uuid;
  v_owner_user_id uuid;
  v_anna_membership_id uuid;
  v_anna_user_id uuid;
  v_bb10_id uuid;
  v_bb10_cycle_id uuid;
  v_parent_task_id uuid;
  v_occurrence_id uuid;
  v_policy_id uuid;
  v_task_id uuid;
  v_spray_1_task_id uuid;
  v_spray_2_task_id uuid;
  v_spray_3_task_id uuid;
  v_reassess_task_id uuid;
  v_item record;
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm';
  select id into v_zone_id from atlas.zones where farm_id=v_farm_id and stable_key='barn_beds';
  select id,user_id into v_owner_membership_id,v_owner_user_id
  from atlas.farm_memberships where farm_id=v_farm_id and worker_key='lex' and active limit 1;
  select id,user_id into v_anna_membership_id,v_anna_user_id
  from atlas.farm_memberships where farm_id=v_farm_id and worker_key='anna' and active limit 1;
  select id into v_bb10_id from atlas.growing_objects where farm_id=v_farm_id and stable_key='bb_10';
  select id into v_bb10_cycle_id from atlas.crop_cycles
  where farm_id=v_farm_id and object_id=v_bb10_id
    and crop_profile_id=(select id from atlas.crop_profiles where stable_key='sunflower_procut_horizon')
  order by created_at desc limit 1;
  select id into v_parent_task_id from atlas.tasks
  where farm_id=v_farm_id and metadata->>'task_key'='owner_20260825_sow_procut_horizon_bb10' limit 1;

  update atlas.crop_cycles
  set cycle_state='planned',lifecycle_status='planned',sown_date=null,planted_date=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'readiness_blocked',true,
        'readiness_blocked_reason','Bermuda grass requires three spray treatments at 10-day intervals and a readiness confirmation.',
        'readiness_blocked_until','2026-08-25',
        'treatment_sequence',jsonb_build_array('2026-08-04','2026-08-14','2026-08-24'),
        'physical_truth_source','marshall_text_20260804'
      ),updated_at=now()
  where id=v_bb10_cycle_id;

  update atlas.object_state
  set life_status='under_reset',weed_pressure='heavy',decision_required=false,
      operational_truth='unavailable_for_planting',operational_truth_source='owner_instruction_20260804',
      operational_truth_changed_at=now(),last_checked_at=date '2026-08-04',
      metadata=(coalesce(metadata,'{}'::jsonb)-'spray_hold_until'-'planned_sow_not_before'-'weed_control_status'-'management_decision')
        ||jsonb_build_object(
          'stand_status','bermuda_grass_treatment','availability','unavailable',
          'unavailable_reason','Bermuda grass treatment in progress','bermuda_treatment_start','2026-08-04',
          'bermuda_treatment_dates',jsonb_build_array('2026-08-04','2026-08-14','2026-08-24'),
          'readiness_review_on','2026-08-25','ordinary_weeding_suppressed',true,
          'management_decision','Spray three times at 10-day intervals, then confirm the bed is ready before sowing.'
        ),updated_at=now()
  where object_id=v_bb10_id;

  update atlas.growing_objects
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'planned_crop','ProCut Horizon sunflower','availability','unavailable',
        'availability_reason','Bermuda grass treatment in progress','bermuda_treatment_start','2026-08-04',
        'bermuda_treatment_dates',jsonb_build_array('2026-08-04','2026-08-14','2026-08-24'),
        'readiness_review_on','2026-08-25'
      ),updated_at=now()
  where id=v_bb10_id;

  insert into atlas.object_activity_events(
    farm_id,object_id,event_type,event_date,note,created_by,source,metadata,idempotency_key
  )
  select v_farm_id,v_bb10_id,'observed',date '2026-08-04',
    'BB10 has Bermuda grass and is unavailable for sowing until a three-pass treatment sequence is complete and the bed is reassessed.',
    'owner','owner_instruction',jsonb_build_object('condition','bermuda_grass','treatmentPasses',3,'intervalDays',10),
    'owner:bb10:bermuda-observed:2026-08-04'
  where not exists(select 1 from atlas.object_activity_events where idempotency_key='owner:bb10:bermuda-observed:2026-08-04');

  update atlas.weed_cards
  set current_condition='heavy',next_review_on=date '2026-08-25',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'ordinaryWeedWorkSuppressed',true,
        'suppressionReason','Bermuda grass is in a chemical-treatment sequence owned by Lex.',
        'suppressedUntil','2026-08-25','treatmentPasses',3,'treatmentIntervalDays',10
      ),updated_at=now()
  where object_id=v_bb10_id;

  update atlas.maintenance_objects
  set active=false,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'pausedAt',now(),'pausedReason','Bermuda grass chemical-treatment sequence replaces ordinary weeding until reassessment.',
        'pausedUntil','2026-08-25'
      ),updated_at=now()
  where object_id=v_bb10_id and maintenance_type='weed';

  update atlas.rhythm_state
  set state='paused',warning_at=null,due_at=null,failure_at=null,current_task_id=null,current_occurrence_id=null,
      assigned_user_id=null,visibility_scope='management',
      state_reason=jsonb_build_object('source','owner_instruction_20260804','reason','Bermuda grass chemical-treatment sequence replaces ordinary weed rhythm.','resumeReviewOn','2026-08-25'),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('pausedUntil','2026-08-25','pausedBy','bb10_bermuda_treatment_v1'),
      last_transition_at=now(),updated_at=now()
  where farm_id=v_farm_id and rhythm_key='weed_stewardship' and subject_kind='growing_object' and subject_id=v_bb10_id;

  for v_item in
    select * from (values
      ('anna_20260804_grey_couch_garage','Grey Couch in Garage','general',null::text,date '2026-08-04','normal',v_anna_membership_id,v_anna_user_id,'Anna',null::uuid,'Farmhouse',null::text),
      ('anna_20260805_school_preschool_enrollment','School and Preschool Enrollment','administrative','complete',date '2026-08-05','normal',v_anna_membership_id,v_anna_user_id,'Anna',null::uuid,'Administration','Complete'),
      ('anna_20260805_wash_dry_store_soil_blockers','Wash, Dry + Store Soil Blockers on Garage Shelf','cleanup','clean',date '2026-08-05','normal',v_anna_membership_id,v_anna_user_id,'Anna',null::uuid,'Garage','Wash, dry + store'),
      ('owner_20260804_spray_bb10_bermuda_pass_1','Spray BB10 for Bermuda Grass — Pass 1','weed_control','spray',date '2026-08-04','high',v_owner_membership_id,v_owner_user_id,'owner',v_bb10_id,'Barn Beds','Spray'),
      ('owner_20260814_spray_bb10_bermuda_pass_2','Spray BB10 for Bermuda Grass — Pass 2','weed_control','spray',date '2026-08-14','high',v_owner_membership_id,v_owner_user_id,'owner',v_bb10_id,'Barn Beds','Spray'),
      ('owner_20260824_spray_bb10_bermuda_pass_3','Spray BB10 for Bermuda Grass — Pass 3','weed_control','spray',date '2026-08-24','high',v_owner_membership_id,v_owner_user_id,'owner',v_bb10_id,'Barn Beds','Spray'),
      ('owner_20260825_confirm_bb10_ready_to_sow','Confirm BB10 Is Ready to Sow','inspection','inspect',date '2026-08-25','high',v_owner_membership_id,v_owner_user_id,'owner',v_bb10_id,'Barn Beds','Confirm')
    ) as item(task_key,title,task_type,action_key,due_date,priority,membership_id,user_id,assigned_to,object_id,collection_zone,display_action)
  loop
    v_occurrence_id := atlas.plan_work_occurrence_v1(
      v_farm_id,'one_off:'||v_item.task_key,'one_off:'||v_item.task_key||':release','one_off:'||v_item.task_key,
      v_item.title,v_item.task_type,v_item.due_date,'owner_instruction',null,'time_window',30,1,
      jsonb_build_object(
        'farm_id',v_farm_id,'zone_id',case when v_item.object_id is null then null else v_zone_id end,
        'title',v_item.title,'task_type',v_item.task_type,'status','open','priority',v_item.priority,'due_date',v_item.due_date,
        'action_key',v_item.action_key,'work_class','standard','work_lane','required','commitment_kind','hard_date',
        'task_scope','farm_operation','origin_kind','owner_assigned','visibility_scope','assigned_worker',
        'assigned_membership_id',v_item.membership_id,'assigned_user_id',v_item.user_id,'created_by_user_id',v_owner_user_id,
        'metadata',jsonb_strip_nulls(jsonb_build_object(
          'task_key',v_item.task_key,'anna_task',v_item.assigned_to='Anna','owner_task',v_item.assigned_to='owner',
          'assigned_to',v_item.assigned_to,'assignee_key',lower(v_item.assigned_to),
          'executor_membership_id',v_item.membership_id,
          'executor_worker_key',case when v_item.assigned_to='Anna' then 'anna' else 'lex' end,
          'display_action',v_item.display_action,'display_subject',v_item.title,
          'display_location',case when v_item.object_id is null then null else 'BB10' end,
          'collection_zone',v_item.collection_zone,'work_lane','required','commitment_kind','hard_date','date_commitment','hard_date',
          'simple_completion_task',v_item.task_key='anna_20260804_grey_couch_garage','owner_instruction_date','2026-08-04'
        ))
      ),'{}'::jsonb,jsonb_build_object('automatic',false,'source_kind','owner_instruction'),v_item.due_date,
      jsonb_build_object('source','owner_instruction_20260804','hardDate',true)
    );

    select release_policy_id into v_policy_id from atlas.planned_work_occurrences where id=v_occurrence_id;
    select id into v_task_id from atlas.tasks where farm_id=v_farm_id and metadata->>'task_key'=v_item.task_key order by created_at limit 1;

    if v_task_id is null then
      insert into atlas.tasks(
        farm_id,zone_id,title,task_type,status,priority,due_date,note,metadata,action_key,work_class,
        visibility_scope,assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,task_scope,
        planned_occurrence_id,release_policy_id,released_at,release_reason,work_lane,commitment_kind,effort_units
      ) values(
        v_farm_id,case when v_item.object_id is null then null else v_zone_id end,v_item.title,v_item.task_type,
        'open',v_item.priority,v_item.due_date,null,
        jsonb_strip_nulls(jsonb_build_object(
          'task_key',v_item.task_key,'anna_task',v_item.assigned_to='Anna','owner_task',v_item.assigned_to='owner',
          'assigned_to',v_item.assigned_to,'assignee_key',lower(v_item.assigned_to),
          'executor_membership_id',v_item.membership_id,
          'executor_worker_key',case when v_item.assigned_to='Anna' then 'anna' else 'lex' end,
          'display_action',v_item.display_action,'display_subject',v_item.title,
          'display_location',case when v_item.object_id is null then null else 'BB10' end,
          'collection_zone',v_item.collection_zone,'work_lane','required','commitment_kind','hard_date','date_commitment','hard_date',
          'simple_completion_task',v_item.task_key='anna_20260804_grey_couch_garage','owner_instruction_date','2026-08-04'
        )),v_item.action_key,'standard','assigned_worker',v_item.membership_id,v_item.user_id,v_owner_user_id,
        'owner_assigned','farm_operation',v_occurrence_id,v_policy_id,now(),'owner_instruction_20260804','required','hard_date',1
      ) returning id into v_task_id;
    else
      update atlas.tasks
      set title=v_item.title,task_type=v_item.task_type,priority=v_item.priority,due_date=v_item.due_date,
          assigned_membership_id=v_item.membership_id,assigned_user_id=v_item.user_id,visibility_scope='assigned_worker',
          status=case when status in ('done','skipped','archived') then status else 'open' end,
          planned_occurrence_id=coalesce(planned_occurrence_id,v_occurrence_id),
          release_policy_id=coalesce(release_policy_id,v_policy_id),released_at=coalesce(released_at,now()),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'assigned_to',v_item.assigned_to,'assignee_key',lower(v_item.assigned_to),
            'work_lane','required','commitment_kind','hard_date','date_commitment','hard_date'
          ),updated_at=now()
      where id=v_task_id;
    end if;

    update atlas.planned_work_occurrences
    set state='released',released_at=coalesce(released_at,now()),released_task_id=v_task_id,updated_at=now()
    where id=v_occurrence_id;

    if v_item.object_id is not null then
      insert into atlas.task_objects(task_id,object_id,role)
      select v_task_id,v_item.object_id,'target'
      where not exists(select 1 from atlas.task_objects where task_id=v_task_id and object_id=v_item.object_id);
    end if;
  end loop;

  select id into v_spray_1_task_id from atlas.tasks where farm_id=v_farm_id and metadata->>'task_key'='owner_20260804_spray_bb10_bermuda_pass_1' limit 1;
  select id into v_spray_2_task_id from atlas.tasks where farm_id=v_farm_id and metadata->>'task_key'='owner_20260814_spray_bb10_bermuda_pass_2' limit 1;
  select id into v_spray_3_task_id from atlas.tasks where farm_id=v_farm_id and metadata->>'task_key'='owner_20260824_spray_bb10_bermuda_pass_3' limit 1;
  select id into v_reassess_task_id from atlas.tasks where farm_id=v_farm_id and metadata->>'task_key'='owner_20260825_confirm_bb10_ready_to_sow' limit 1;

  insert into atlas.task_prerequisites(
    farm_id,downstream_task_id,prerequisite_task_id,required_status,hold_mode,sequence_order,active,metadata
  ) values
    (v_farm_id,v_spray_2_task_id,v_spray_1_task_id,'done','deferred_hidden',100,true,jsonb_build_object('reason','Second pass follows the first treatment.')),
    (v_farm_id,v_spray_3_task_id,v_spray_2_task_id,'done','deferred_hidden',200,true,jsonb_build_object('reason','Third pass follows the second treatment.')),
    (v_farm_id,v_reassess_task_id,v_spray_3_task_id,'done','deferred_hidden',300,true,jsonb_build_object('reason','Readiness is checked after the third treatment.')),
    (v_farm_id,v_parent_task_id,v_reassess_task_id,'done','deferred_hidden',400,true,jsonb_build_object('reason','BB10 cannot be sown until the owner confirms it is ready.'))
  on conflict(downstream_task_id,prerequisite_task_id) do update
  set required_status=excluded.required_status,hold_mode=excluded.hold_mode,sequence_order=excluded.sequence_order,
      active=true,metadata=atlas.task_prerequisites.metadata||excluded.metadata,updated_at=now();

  perform atlas.reconcile_task_prerequisite_gate_v1(v_spray_2_task_id,now());
  perform atlas.reconcile_task_prerequisite_gate_v1(v_spray_3_task_id,now());
  perform atlas.reconcile_task_prerequisite_gate_v1(v_reassess_task_id,now());
  perform atlas.reconcile_task_prerequisite_gate_v1(v_parent_task_id,now());
  perform atlas.sync_crop_cycle_registry_v1(v_farm_id,v_bb10_id);
end;
$migration$;

commit;
