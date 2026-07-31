-- Decorate Clock-released mowing tasks and expose mowing in the Owner Rulebook.

create or replace function atlas.decorate_biological_clock_task_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_rhythm text := coalesce(new.metadata->>'rhythm_key','');
  v_state_id uuid := atlas.rhythm_safe_uuid_v1(new.metadata->>'rhythm_state_id');
  v_cycle atlas.crop_cycles%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_zone atlas.zones%rowtype;
begin
  if new.generated_from <> 'rhythm_clock' or v_state_id is null then return new; end if;

  if v_rhythm='grow_room_care' then
    new.title := 'Grow Room Care';
    new.task_type := 'grow_room_care';
    new.action_key := 'grow_room_round';
    new.work_class := 'standard';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'manual_top_level_card',true,'round_completion_required',true,
      'display_action','Care round','display_subject','Grow Room','collection_zone','Grow Room',
      'work_rhythm','Grow Room Care','time_claims_physical_condition',false
    );
  elsif v_rhythm='guest_readiness' then
    select z.* into v_zone
    from atlas.rhythm_state rs join atlas.zones z on z.id=rs.subject_id
    where rs.id=v_state_id and rs.subject_kind='zone';
    new.title := case
      when lower(coalesce(new.metadata->>'initial_guest_readiness_acceptance','false')) in ('true','yes','1') then 'Final clean, photograph + Guest Readiness acceptance'
      when coalesce(new.metadata->>'rhythm_target_state','')='fallen_out_of_rhythm' then 'Restore guest readiness — '||coalesce(nullif(v_zone.label,''),'Venue')
      else 'Guest readiness walk — '||coalesce(nullif(v_zone.label,''),'Venue') end;
    new.task_type := 'guest_readiness_round';
    new.action_key := 'guest_readiness';
    new.work_class := 'light';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'task_style','guest_readiness_round','structured_result_required',true,
      'venue_zone_id',v_zone.id,'venue_zone_label',v_zone.label,
      'display_action','Check guest readiness','display_subject',coalesce(nullif(v_zone.label,''),'Venue'),
      'display_detail','Entry · Bathroom · Kitchen · Lounge · Library · Conference Room · Studio',
      'collection_zone',coalesce(nullif(v_zone.label,''),'Venue'),
      'work_rhythm','Guest Readiness','time_claims_physical_condition',false
    );
  elsif v_rhythm='mowing' then
    select go.* into v_object
    from atlas.rhythm_state rs join atlas.growing_objects go on go.id=rs.subject_id
    where rs.id=v_state_id and rs.subject_kind='growing_object';
    new.title := case when coalesce(new.metadata->>'rhythm_target_state','')='fallen_out_of_rhythm'
      then 'Restore mowing rhythm — '||coalesce(nullif(v_object.label,''),'Mowing route')
      else 'Mow — '||coalesce(nullif(v_object.label,''),'Mowing route') end;
    new.task_type := 'mowing';
    new.action_key := 'mow';
    new.work_class := 'standard';
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'task_style','mowing_round','structured_result_required',true,'clock_managed',true,
      'mowing_route_object_id',v_object.id,'mowing_route_key',v_object.stable_key,
      'display_action','Mow','display_subject',coalesce(nullif(v_object.label,''),'Mowing route'),
      'display_detail',coalesce(nullif(v_object.metadata->>'equipment_group',''),'Observe the route before choosing a result'),
      'collection_zone',coalesce(nullif(v_object.metadata->>'zone_label',''),nullif(v_object.label,''),'Mowing'),
      'work_collection_key','mowing','work_collection_role','member','work_rhythm','Mowing',
      'collection_member_key',v_object.stable_key,'canonical_collection_member_key',v_object.stable_key,
      'equipment_group',v_object.metadata->>'equipment_group',
      'target_cut_height_inches',v_object.metadata->>'target_cut_height_inches',
      'recreate_on_done',false,'time_claims_physical_condition',false
    );
  elsif v_rhythm in ('germination_watch','harvest_watch') then
    select cc.* into v_cycle
    from atlas.rhythm_state rs join atlas.crop_cycles cc on cc.id=rs.subject_id
    where rs.id=v_state_id and rs.subject_kind='crop_cycle';
    if v_cycle.id is not null then
      select * into v_object from atlas.growing_objects where id=v_cycle.object_id;
      if v_rhythm='germination_watch' then
        new.title := 'Check germination — '||coalesce(nullif(v_cycle.crop_label,''),'Crop')||' · '||coalesce(nullif(v_object.label,''),'Growing area');
        new.task_type := 'germination_check';
        new.action_key := 'germination_check';
        new.work_class := 'crop_cycle';
        new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
          'task_style','germination_check','milestone','germination_check',
          'crop_cycle_id',v_cycle.id,'crop_cycle_key',v_cycle.crop_cycle_key,'crop_label',v_cycle.crop_label,'variety',v_cycle.variety,
          'object_id',v_cycle.object_id,'object_label',v_object.label,
          'expected_germination_start',v_cycle.expected_germination_start,'expected_germination_end',v_cycle.expected_germination_end,
          'display_action','Check germination','display_subject',coalesce(nullif(v_cycle.variety,''),v_cycle.crop_label),
          'collection_zone',v_object.label,'time_claims_physical_condition',false
        );
      else
        new.title := 'Harvest watch — '||coalesce(nullif(v_cycle.variety,''),nullif(v_cycle.crop_label,''),'Crop')||' · '||coalesce(nullif(v_object.label,''),'Growing area');
        new.task_type := 'harvest_watch';
        new.action_key := 'harvest_watch';
        new.work_class := 'crop_cycle';
        new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
          'task_style','harvest_watch','milestone','harvest_watch','structured_result_required',true,
          'crop_cycle_id',v_cycle.id,'crop_cycle_key',v_cycle.crop_cycle_key,'crop_label',v_cycle.crop_label,'variety',v_cycle.variety,
          'object_id',v_cycle.object_id,'object_label',v_object.label,
          'expected_harvest_watch_start',v_cycle.expected_harvest_watch_start,'expected_harvest_watch_end',v_cycle.expected_harvest_watch_end,
          'display_action','Check harvest stage','display_subject',coalesce(nullif(v_cycle.variety,''),v_cycle.crop_label),
          'collection_zone',v_object.label,'time_claims_physical_condition',false
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function atlas.biological_rhythm_dashboard_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,atlas
as $$
declare v_items jsonb;
begin
  if auth.uid() is null or not atlas.is_farm_owner(p_farm_id) then raise exception 'Only a farm Owner may read farm rhythm controls.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'stateId',rs.id,'bindingId',rs.rhythm_binding_id,'ruleId',rr.id,'rhythmKey',rs.rhythm_key,'ruleKey',rr.rule_key,'ruleLabel',rr.label,'ruleVersion',rr.version,
    'subjectKind',rs.subject_kind,'subjectId',rs.subject_id,
    'subjectLabel',case
      when rs.subject_kind='growing_object' then (select label from atlas.growing_objects where id=rs.subject_id)
      when rs.subject_kind='crop_cycle' then (select concat_ws(' · ',coalesce(nullif(variety,''),crop_label),(select label from atlas.growing_objects where id=object_id)) from atlas.crop_cycles where id=rs.subject_id)
      when rs.subject_kind='zone' then (select label from atlas.zones where id=rs.subject_id)
      else rs.subject_id::text end,
    'state',rs.state,'warningAt',rs.warning_at,'dueAt',rs.due_at,'failureAt',rs.failure_at,'currentTaskId',rs.current_task_id,'bindingActive',rb.active,
    'validitySeconds',rr.validity_interval_seconds,'warningSeconds',rr.warning_window_seconds,'graceSeconds',rr.grace_window_seconds,
    'why',case
      when rs.rhythm_key='grow_room_care' then 'A completed Grow Room round keeps this rhythm valid. Time can open another care round, but it never claims the room is dry or healthy.'
      when rs.rhythm_key='germination_watch' then 'A sowing opened a germination watch. Only a recorded germination observation renews or closes it; manual rescheduling does not.'
      when rs.rhythm_key='harvest_watch' then 'A real planting and harvest window opened this watch. Time asks for an observation; only a field result may declare the crop ready, declining, or finished.'
      when rs.rhythm_key='mowing' then 'A completed mow or an explicit acceptable-no-cut observation renews this route. Time can return the route for attention, but it never claims the grass is long, dry, or safe to mow.'
      else 'A completed room-by-room Guest Readiness round keeps the venue in rhythm. Time can require another walk, but it never claims a room is dirty or ready.' end,
    'controls',jsonb_build_object('pauseAppliesToRule',true,'canExtendState',true,'canForgiveState',true,'canReviseRule',true)
  ) order by rs.rhythm_key,rs.due_at nulls last),'[]'::jsonb) into v_items
  from atlas.rhythm_state rs join atlas.rhythm_rules rr on rr.id=rs.rhythm_rule_id join atlas.rhythm_bindings rb on rb.id=rs.rhythm_binding_id
  where rs.farm_id=p_farm_id and rs.rhythm_key in ('grow_room_care','germination_watch','harvest_watch','guest_readiness','mowing');
  return jsonb_build_object('contractVersion','biological_rhythm_dashboard_v1','farmId',p_farm_id,'items',v_items);
end;
$$;

grant execute on function atlas.biological_rhythm_dashboard_v1(uuid) to authenticated;
