create or replace function atlas.normalize_clock_mowing_card_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_object atlas.growing_objects%rowtype;
  v_state_id uuid;
  v_equipment text;
  v_height_text text;
  v_height_label text;
begin
  v_state_id:=atlas.rhythm_safe_uuid_v1(new.metadata->>'rhythm_state_id');

  if coalesce(new.metadata->>'rhythm_key','')='mowing' and v_state_id is not null then
    select go.* into v_object
    from atlas.rhythm_state rs
    join atlas.growing_objects go on go.id=rs.subject_id
    where rs.id=v_state_id and rs.subject_kind='growing_object';

    if v_object.id is not null then
      v_equipment:=nullif(v_object.metadata->>'equipment_group','');
      v_height_text:='3';
      v_height_label:='3';

      new.metadata:=coalesce(new.metadata,'{}'::jsonb)-'battery_resource_key'-'riding_mower_resource_key';

      if lower(replace(coalesce(v_equipment,''),'_',' ')) in ('push mower','battery push mower') then
        v_equipment:='Battery push mower';
        new.metadata:=jsonb_set(new.metadata,'{required_resource_keys}',jsonb_build_array('battery_push_mower_battery_set'),true);
        new.metadata:=jsonb_set(new.metadata,'{battery_resource_key}',to_jsonb('battery_push_mower_battery_set'::text),true);
      elsif lower(replace(coalesce(v_equipment,''),'_',' ')) in ('riding mower','riding lawn mower') then
        v_equipment:='Riding mower';
        new.metadata:=jsonb_set(new.metadata,'{required_resource_keys}',jsonb_build_array('cub_cadet_lawn_mower'),true);
        new.metadata:=jsonb_set(new.metadata,'{riding_mower_resource_key}',to_jsonb('cub_cadet_lawn_mower'::text),true);
      end if;

      new.title:='Mow — '||coalesce(nullif(v_object.label,''),'Mowing route');
      new.metadata:=new.metadata||jsonb_strip_nulls(jsonb_build_object(
        'display_action','Mow',
        'display_subject',coalesce(nullif(v_object.label,''),'Mowing route'),
        'display_detail',v_equipment,
        'equipment_group',v_equipment,
        'target_cut_height_inches',v_height_text,
        'cut_height_label','Cut to 3 in'
      ));
    end if;
  end if;
  return new;
end;
$function$;

create or replace function atlas.record_mowing_result_core_v1(
  p_task_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_outcome text,
  p_completion_percent integer,
  p_recheck_date date,
  p_note text,
  p_idempotency_key text,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_result jsonb;
  v_effect jsonb:=jsonb_build_object('state','not_applicable');
  v_event_id uuid;
  v_task atlas.tasks%rowtype;
  v_actor_user_id uuid;
  v_owner_user_id uuid;
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_route text;
begin
  v_result:=atlas.record_mowing_result_core_pre_or2_v1(
    p_task_id,p_effective_membership_id,p_effective_role,p_outcome,p_completion_percent,
    p_recheck_date,p_note,p_idempotency_key,p_operator_mode
  );

  v_event_id:=atlas.rhythm_safe_uuid_v1(v_result->>'eventId');

  if p_outcome='mowed_full' then
    if v_event_id is not null then
      begin
        v_effect:=atlas.apply_mowing_resource_effect_v1(p_task_id,v_event_id,p_effective_membership_id);
      exception when others then
        v_effect:=jsonb_build_object(
          'state','reconciliation_required',
          'reason','Mowing result was preserved but the reusable-resource consequence could not be applied.',
          'error',sqlerrm,
          'truthBoundary',jsonb_build_object('mowingResultRolledBack',false,'resourceEffectNeedsRepair',true)
        );
      end;
    end if;
  end if;

  if v_note is not null and lower(coalesce(p_effective_role,''))='farm_hand' and v_event_id is not null then
    select * into v_task from atlas.tasks where id=p_task_id;
    select fm.user_id into v_actor_user_id
    from atlas.farm_memberships fm
    where fm.id=p_effective_membership_id;

    select fm.user_id into v_owner_user_id
    from atlas.farm_memberships fm
    where fm.farm_id=v_task.farm_id and fm.role='owner' and fm.active=true
    order by fm.created_at
    limit 1;

    v_route:=coalesce(nullif(v_task.metadata->>'display_subject',''),nullif(v_task.title,''),'mowing task');

    if v_owner_user_id is not null then
      insert into atlas.journal_event_index(
        organization_id,farm_id,event_key,event_kind,source_kind,source_id,source_event,
        occurred_at,journal_date,actor_user_id,assigned_user_id,task_id,title,detail,
        visibility_scope,importance,payload,provenance
      ) values (
        v_task.organization_id,v_task.farm_id,'mowing_worker_note:'||v_event_id::text,
        'task_result','mowing_result',v_event_id,'worker_note',now(),
        (now() at time zone 'America/Chicago')::date,v_actor_user_id,v_owner_user_id,p_task_id,
        'Anna left a mowing note — '||v_route,v_note,'owner','attention',
        jsonb_build_object('taskId',p_task_id,'mowingEventId',v_event_id,'outcome',p_outcome,'sourceMembershipId',p_effective_membership_id),
        jsonb_build_object('source','record_mowing_result_core_v1','routing','worker_note_to_owner')
      )
      on conflict (farm_id,event_key) do update set
        detail=excluded.detail,
        assigned_user_id=excluded.assigned_user_id,
        importance='attention',
        updated_at=now();

      perform atlas.enqueue_direct_push_v1(
        v_task.farm_id,v_owner_user_id,'other_player_result',
        'Anna left a mowing note — '||v_route,left(v_note,240),'/bell',
        'mowing_worker_note:'||v_event_id::text,'attention',now(),
        jsonb_build_object('taskId',p_task_id,'mowingEventId',v_event_id,'sourceMembershipId',p_effective_membership_id)
      );
    end if;
  end if;

  return v_result||jsonb_build_object(
    'resourceEffect',v_effect,
    'immediateContinuation',coalesce(v_effect->'continuation',jsonb_build_object('humanActionRequired',false)),
    'operationResultMembrane','operation_result_state_transition_or2'
  );
end;
$function$;
