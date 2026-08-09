create or replace function atlas.worker_day_available_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $$
  select extract(isodow from p_day) <> 7
    and not exists (
      select 1
      from atlas.member_unavailability u
      where u.farm_id=p_farm_id
        and u.membership_id=p_membership_id
        and u.active=true
        and p_day between u.unavailable_start and u.unavailable_end
    );
$$;

create or replace function atlas.worker_day_on_or_after_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
) returns date
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_day date:=p_day;
  v_guard integer:=0;
begin
  while not atlas.worker_day_available_v1(p_farm_id,p_membership_id,v_day) loop
    v_day:=v_day+1;
    v_guard:=v_guard+1;
    if v_guard>370 then
      raise exception 'No available worker day found within one year.' using errcode='55000';
    end if;
  end loop;
  return v_day;
end;
$$;

create or replace function atlas.next_worker_day_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
) returns date
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $$
  select atlas.worker_day_on_or_after_v1(p_farm_id,p_membership_id,p_day+1);
$$;

create or replace function atlas.worker_task_day_window_v1(
  p_action_key text,
  p_task_type text,
  p_metadata jsonb
) returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_metadata->>'work_window_key','')) in ('morning','afternoon','evening') then lower(p_metadata->>'work_window_key')
    when lower(coalesce(p_metadata->>'daypart','')) in ('morning','afternoon','evening') then lower(p_metadata->>'daypart')
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('top','morning','upper','first') then 'morning'
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('midday','midday_flex','visibility','visibility_prep','anchored') then 'afternoon'
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('evening','lower','bottom','last','last_thing') then 'evening'
    when lower(coalesce(p_action_key,''))='mow' or lower(coalesce(p_metadata->>'work_collection_key',''))='mowing' then 'evening'
    when lower(coalesce(p_action_key,'')) in ('plant','transplant','sow','seed')
      or lower(coalesce(p_task_type,'')) in ('sowing','transplanting')
      or lower(coalesce(p_metadata->>'work_rhythm',''))='seed_sowing' then 'evening'
    when lower(coalesce(p_action_key,''))='weed' or lower(coalesce(p_metadata->>'work_collection_key',''))='weeding' then 'morning'
    when lower(coalesce(p_action_key,''))='harvest' or lower(coalesce(p_task_type,''))='postharvest' then 'morning'
    when lower(coalesce(p_action_key,''))='water' or lower(coalesce(p_task_type,'')) in ('grow_room_care','germination_check') then 'morning'
    else 'afternoon'
  end;
$$;

create or replace function atlas.worker_task_order_v1(
  p_action_key text,
  p_task_type text,
  p_metadata jsonb
) returns integer
language plpgsql
immutable
as $$
declare
  v_explicit integer;
  v_window text;
  v_day_order integer:=0;
begin
  begin
    v_explicit:=coalesce(
      nullif(p_metadata->>'day_work_order','')::integer,
      nullif(p_metadata->>'work_order','')::integer,
      nullif(p_metadata->>'day_order_override','')::integer,
      nullif(p_metadata->>'run_sheet_order','')::integer
    );
  exception when invalid_text_representation then v_explicit:=null;
  end;
  if v_explicit is not null then return v_explicit; end if;
  begin
    v_day_order:=greatest(0,least(coalesce(nullif(p_metadata->>'day_order','')::integer,0),999));
  exception when invalid_text_representation then v_day_order:=0;
  end;
  v_window:=atlas.worker_task_day_window_v1(p_action_key,p_task_type,p_metadata);
  return case v_window when 'morning' then 22000 when 'evening' then 76000 else 42000 end + v_day_order;
end;
$$;

create or replace function atlas.owner_worker_day_plan_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_membership atlas.farm_memberships%rowtype;
  v_timezone text:='America/Chicago';
  v_today date;
  v_first_workday date;
  v_target integer:=420;
  v_committed integer:=0;
  v_automatic_minutes integer:=0;
  v_remaining integer:=0;
  v_real jsonb:='[]'::jsonb;
  v_automatic jsonb:='[]'::jsonb;
  v_floating jsonb:='[]'::jsonb;
  v_project jsonb:='[]'::jsonb;
  v_warnings jsonb:='[]'::jsonb;
  v_active_weed record;
  v_queue record;
  v_cursor date;
  v_occ_payload jsonb;
  v_occ_meta jsonb;
  v_minutes integer;
  v_mow_next jsonb:='{}'::jsonb;
  v_mow_cadence jsonb:='{}'::jsonb;
  v_mow_title jsonb:='{}'::jsonb;
  v_mow_location jsonb:='{}'::jsonb;
  v_mow_route jsonb:='{}'::jsonb;
  v_day date;
  v_rule_id text;
  v_rule_cadence integer;
  v_explicit_mow record;
  v_task_route text;
  v_real_has_mow boolean:=false;
  v_real_has_active_weed boolean:=false;
begin
  if p_day is null then raise exception 'A worker day is required.' using errcode='22023'; end if;
  select * into v_membership from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;
  if v_membership.id is null or v_membership.role<>'farm_hand' then raise exception 'Active Farm Hand membership required.' using errcode='42501'; end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone from atlas.farms f where f.id=p_farm_id;
  v_today:=(now() at time zone v_timezone)::date;
  v_first_workday:=atlas.worker_day_on_or_after_v1(p_farm_id,p_membership_id,v_today);
  select coalesce(settings.regular_target_minutes,420) into v_target
  from atlas.farm_memberships fm
  left join atlas.member_capacity_settings settings on settings.farm_id=fm.farm_id and settings.membership_id=fm.id and settings.active=true
  where fm.id=p_membership_id and fm.farm_id=p_farm_id;
  v_target:=coalesce(v_target,420);

  if not atlas.worker_day_available_v1(p_farm_id,p_membership_id,p_day) then
    return jsonb_build_object('contractVersion','owner_worker_day_plan_v1','farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,
      'availableWorkerDay',false,'paidTargetMinutes',v_target,'committedPaidMinutes',0,'automaticPaidMinutes',0,'remainingPaidMinutes',v_target,
      'realWork','[]'::jsonb,'automaticWork','[]'::jsonb,'suggestions','[]'::jsonb,'warnings','[]'::jsonb);
  end if;

  begin
    with ids as (
      select t.id as task_id from atlas.tasks t
      where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id and t.status in ('open','blocked') and t.due_date=p_day
        and t.parent_task_id is null and nullif(t.metadata->>'parent_task_id','') is null and coalesce((t.metadata->>'is_child_task')::boolean,false)=false
      union
      select carry.task_id from atlas.member_day_carryover_v1(p_farm_id,p_membership_id,p_day) carry
    ), rows as (
      select t.*,capacity.expected_active_minutes,
        atlas.worker_task_day_window_v1(t.action_key,t.task_type,t.metadata) as day_window,
        atlas.worker_task_order_v1(t.action_key,t.task_type,t.metadata) as work_order
      from ids join atlas.tasks t on t.id=ids.task_id cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id','task:'||rows.id::text,'kind','real','sourceKind','task','sourceId',rows.id,'taskId',rows.id,'title',rows.title,'status',rows.status,
      'expectedActiveMinutes',rows.expected_active_minutes,'dayWindow',rows.day_window,'workOrderNumber',rows.work_order,
      'location',coalesce(nullif(rows.metadata->>'display_location',''),nullif(rows.metadata->>'collection_zone',''),nullif(rows.metadata->>'collection_label','')),
      'automatic',false,'requiresOwnerApproval',false
    ) order by case rows.day_window when 'morning' then 0 when 'afternoon' then 1 else 2 end,rows.work_order,rows.title,rows.id),'[]'::jsonb),
    coalesce(sum(rows.expected_active_minutes),0)::integer,
    coalesce(bool_or(rows.action_key='mow' or lower(coalesce(rows.metadata->>'work_collection_key',''))='mowing'),false)
    into v_real,v_committed,v_real_has_mow from rows;
  exception when others then
    v_warnings:=v_warnings||jsonb_build_array('real_work_unavailable'); v_real:='[]'::jsonb; v_committed:=0;
  end;

  begin
    select qi.id,qi.position,qi.state,qi.task_id,qi.planned_occurrence_id,occurrence.title,occurrence.task_payload,occurrence.effort_units
    into v_active_weed
    from atlas.task_release_queue_items qi join atlas.planned_work_occurrences occurrence on occurrence.id=qi.planned_occurrence_id
    where qi.farm_id=p_farm_id and qi.queue_key='anna_weeding_rotation' and qi.state='active' and occurrence.state not in ('cancelled','completed')
    order by qi.position limit 1;

    if v_active_weed.id is not null then
      if v_active_weed.task_id is not null then
        select exists(select 1 from jsonb_array_elements(v_real) item where item->>'taskId'=v_active_weed.task_id::text) into v_real_has_active_weed;
      end if;
      if p_day=v_first_workday and not v_real_has_active_weed then
        v_occ_payload:=coalesce(v_active_weed.task_payload,'{}'::jsonb); v_occ_meta:=coalesce(v_occ_payload->'metadata','{}'::jsonb);
        v_minutes:=coalesce(nullif(v_occ_meta->>'estimated_minutes','')::integer,
          case when coalesce(v_active_weed.effort_units,0)>0 then greatest(20,round(v_active_weed.effort_units*15)::integer) else 30 end);
        v_automatic:=v_automatic||jsonb_build_array(jsonb_build_object(
          'id','automatic-weed:'||v_active_weed.id::text,'kind','automatic','sourceKind','queue','sourceId',v_active_weed.id,
          'title',coalesce(v_active_weed.title,'Weed Card'),'expectedActiveMinutes',v_minutes,'dayWindow','morning','workOrderNumber',10002,
          'environment','outdoor','location',coalesce(nullif(v_occ_meta->>'display_location',''),nullif(v_occ_meta->>'collection_zone',''),nullif(v_occ_meta->>'collection_label','')),
          'automatic',true,'requiresOwnerApproval',false,'conditional',false,'reason','Automatic daily Weed Card.'));
        v_automatic_minutes:=v_automatic_minutes+v_minutes;
      end if;
      v_cursor:=atlas.next_worker_day_v1(p_farm_id,p_membership_id,v_first_workday);
    else v_cursor:=v_first_workday;
    end if;

    if p_day>=v_cursor then
      for v_queue in
        select qi.id,qi.position,qi.planned_occurrence_id,occurrence.title,occurrence.task_payload,occurrence.effort_units
        from atlas.task_release_queue_items qi join atlas.planned_work_occurrences occurrence on occurrence.id=qi.planned_occurrence_id
        where qi.farm_id=p_farm_id and qi.queue_key='anna_weeding_rotation' and qi.state='queued' and occurrence.state not in ('cancelled','completed')
        order by qi.position
      loop
        if v_cursor=p_day then
          v_occ_payload:=coalesce(v_queue.task_payload,'{}'::jsonb); v_occ_meta:=coalesce(v_occ_payload->'metadata','{}'::jsonb);
          begin
            v_minutes:=coalesce(nullif(v_occ_meta->>'estimated_minutes','')::integer,
              case when coalesce(v_queue.effort_units,0)>0 then greatest(20,round(v_queue.effort_units*15)::integer) else 30 end);
          exception when invalid_text_representation then
            v_minutes:=case when coalesce(v_queue.effort_units,0)>0 then greatest(20,round(v_queue.effort_units*15)::integer) else 30 end;
          end;
          v_automatic:=v_automatic||jsonb_build_array(jsonb_build_object(
            'id','automatic-weed:'||v_queue.id::text,'kind','automatic','sourceKind','queue','sourceId',v_queue.id,
            'title',coalesce(v_queue.title,'Weed Card'),'expectedActiveMinutes',v_minutes,'dayWindow','morning','workOrderNumber',10002,
            'environment','outdoor','location',coalesce(nullif(v_occ_meta->>'display_location',''),nullif(v_occ_meta->>'collection_zone',''),nullif(v_occ_meta->>'collection_label','')),
            'automatic',true,'requiresOwnerApproval',false,'conditional',true,
            'reason','One Weed Card owns each workday. If the prior workday remains unfinished, that card keeps this slot and the queue shifts forward.'));
          v_automatic_minutes:=v_automatic_minutes+v_minutes; exit;
        end if;
        v_cursor:=atlas.next_worker_day_v1(p_farm_id,p_membership_id,v_cursor); exit when v_cursor>p_day;
      end loop;
    end if;
  exception when others then v_warnings:=v_warnings||jsonb_build_array('weed_plan_unavailable');
  end;

  begin
    select coalesce(jsonb_object_agg(rule.id::text,to_jsonb((state.due_at at time zone v_timezone)::date)),'{}'::jsonb),
      coalesce(jsonb_object_agg(rule.id::text,to_jsonb(greatest(1,round(rule.validity_interval_seconds/86400.0)::integer))),'{}'::jsonb),
      coalesce(jsonb_object_agg(rule.id::text,to_jsonb('Mow · '||regexp_replace(rule.label,'^Mowing\\s*·\\s*','','i'))),'{}'::jsonb),
      coalesce(jsonb_object_agg(rule.id::text,to_jsonb(regexp_replace(rule.label,'^Mowing\\s*·\\s*','','i'))),'{}'::jsonb),
      coalesce(jsonb_object_agg(rule.id::text,to_jsonb(regexp_replace(rule.rule_key,'^elm_',''))),'{}'::jsonb)
    into v_mow_next,v_mow_cadence,v_mow_title,v_mow_location,v_mow_route
    from atlas.rhythm_state state join atlas.rhythm_rules rule on rule.id=state.rhythm_rule_id
    where state.farm_id=p_farm_id and state.rhythm_key='mowing' and rule.status='active' and rule.player_routing->>'assignedMembershipId'=p_membership_id::text;

    v_day:=v_first_workday;
    while v_day<=p_day and atlas.jsonb_object_length(v_mow_next)>0 loop
      v_explicit_mow:=null;
      if v_day=v_first_workday then
        select q.* into v_explicit_mow from (
          select t.id,t.title,t.metadata,t.due_date from atlas.tasks t
          where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id and t.status in ('open','blocked') and t.due_date=v_day
            and (t.action_key='mow' or lower(coalesce(t.metadata->>'work_collection_key',''))='mowing')
          union all
          select t.id,t.title,t.metadata,t.due_date from atlas.member_day_carryover_v1(p_farm_id,p_membership_id,v_day) carry join atlas.tasks t on t.id=carry.task_id
          where t.action_key='mow' or lower(coalesce(t.metadata->>'work_collection_key',''))='mowing'
        ) q order by q.due_date nulls last,q.title limit 1;
      else
        select t.id,t.title,t.metadata,t.due_date into v_explicit_mow from atlas.tasks t
        where t.farm_id=p_farm_id and t.assigned_membership_id=p_membership_id and t.status in ('open','blocked') and t.due_date=v_day
          and (t.action_key='mow' or lower(coalesce(t.metadata->>'work_collection_key',''))='mowing')
        order by t.title limit 1;
      end if;

      if v_explicit_mow.id is not null then
        v_task_route:=nullif(v_explicit_mow.metadata->>'mowing_route_key','');
        if v_task_route is null then
          v_task_route:=nullif(v_explicit_mow.metadata->>'canonical_collection_member_key','');
          if v_task_route is not null and v_task_route not like 'mowing_%' then v_task_route:='mowing_'||v_task_route; end if;
        end if;
        if v_task_route is not null then
          select e.key into v_rule_id from jsonb_each_text(v_mow_route) e where e.value=v_task_route limit 1;
          if v_rule_id is not null then
            v_rule_cadence:=coalesce((v_mow_cadence->>v_rule_id)::integer,7);
            v_mow_next:=jsonb_set(v_mow_next,array[v_rule_id],to_jsonb(v_day+v_rule_cadence),true);
          end if;
        end if;
      else
        select e.key into v_rule_id from jsonb_each_text(v_mow_next) e order by e.value::date,coalesce(v_mow_title->>e.key,e.key) limit 1;
        if v_rule_id is not null then
          v_rule_cadence:=coalesce((v_mow_cadence->>v_rule_id)::integer,7);
          if v_day=p_day and not v_real_has_mow then
            v_automatic:=v_automatic||jsonb_build_array(jsonb_build_object(
              'id','automatic-mow:'||v_rule_id||':'||p_day::text,'kind','automatic','sourceKind','rhythm','sourceId',v_rule_id,
              'title',coalesce(v_mow_title->>v_rule_id,'Mow'),'expectedActiveMinutes',case when coalesce(v_mow_route->>v_rule_id,'') like '%follow_me%' then 20 else 60 end,
              'dayWindow','evening','workOrderNumber',99000,'environment','outdoor','location',v_mow_location->>v_rule_id,
              'automatic',true,'requiresOwnerApproval',false,'conditional',true,
              'reason','One mowing area is reserved for each workday. Future mowing is a planning slot until the day becomes real.'));
            v_automatic_minutes:=v_automatic_minutes+case when coalesce(v_mow_route->>v_rule_id,'') like '%follow_me%' then 20 else 60 end;
          end if;
          v_mow_next:=jsonb_set(v_mow_next,array[v_rule_id],to_jsonb(v_day+v_rule_cadence),true);
        end if;
      end if;
      exit when v_day=p_day;
      v_day:=atlas.next_worker_day_v1(p_farm_id,p_membership_id,v_day);
    end loop;
  exception when others then v_warnings:=v_warnings||jsonb_build_array('mowing_plan_unavailable');
  end;

  v_remaining:=greatest(v_target-v_committed-v_automatic_minutes,0);

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'id','floating:'||candidate.task_id::text,'kind','suggestion','sourceKind','floating_task','sourceId',candidate.task_id,
      'title',candidate.title,'note',task.note,'environment',candidate.environment,
      'location',coalesce(nullif(task.metadata->>'display_location',''),nullif(task.metadata->>'collection_zone',''),nullif(task.metadata->>'collection_label','')),
      'expectedActiveMinutes',candidate.expected_active_minutes,
      'dayWindow',atlas.worker_task_day_window_v1(task.action_key,task.task_type,task.metadata),
      'workOrderNumber',atlas.worker_task_order_v1(task.action_key,task.task_type,task.metadata),
      'automatic',false,'requiresOwnerApproval',true,'conditional',false,
      'fitsWithinCurrentRemaining',candidate.expected_active_minutes<=v_remaining,'recommended',true,
      'reason','Eligible paid work from Atlas''s undated work reservoir.'
    ) order by case atlas.worker_task_day_window_v1(task.action_key,task.task_type,task.metadata) when 'morning' then 0 when 'afternoon' then 1 else 2 end,
      atlas.worker_task_order_v1(task.action_key,task.task_type,task.metadata),candidate.title),'[]'::jsonb)
    into v_floating
    from atlas.floating_paid_work_candidates_v1(p_farm_id,p_membership_id,p_day) candidate join atlas.tasks task on task.id=candidate.task_id
    where not (task.action_key='mow' or lower(coalesce(task.metadata->>'work_collection_key',''))='mowing');
  exception when others then v_warnings:=v_warnings||jsonb_build_array('floating_suggestions_unavailable'); v_floating:='[]'::jsonb;
  end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'id','project:'||item.id::text,'kind','suggestion','sourceKind','project_pull','sourceId',item.id,'title',item.title,'note',item.note,
      'environment',item.environment,'location',coalesce(item.location_text,nullif(source_task.metadata->>'display_location',''),nullif(source_task.metadata->>'collection_zone','')),
      'expectedActiveMinutes',greatest(coalesce(item.expected_active_minutes,0),0),
      'dayWindow',atlas.worker_task_day_window_v1(source_task.action_key,source_task.task_type,coalesce(source_task.metadata,item.metadata,'{}'::jsonb)),
      'workOrderNumber',atlas.worker_task_order_v1(source_task.action_key,source_task.task_type,coalesce(source_task.metadata,item.metadata,'{}'::jsonb)),
      'automatic',false,'requiresOwnerApproval',true,'conditional',false,
      'fitsWithinCurrentRemaining',greatest(coalesce(item.expected_active_minutes,0),0)<=v_remaining,'recommended',true,
      'reason','Available Finish Elm work that is ready for Anna.'
    ) order by case atlas.worker_task_day_window_v1(source_task.action_key,source_task.task_type,coalesce(source_task.metadata,item.metadata,'{}'::jsonb)) when 'morning' then 0 when 'afternoon' then 1 else 2 end,
      atlas.worker_task_order_v1(source_task.action_key,source_task.task_type,coalesce(source_task.metadata,item.metadata,'{}'::jsonb)),
      case item.priority when 'critical' then 0 when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end,item.title),'[]'::jsonb)
    into v_project
    from atlas.project_pull_items item join atlas.projects project on project.id=item.project_id left join atlas.tasks source_task on source_task.id=item.source_task_id
    where item.farm_id=p_farm_id and project.farm_id=p_farm_id and project.status='active' and project.stable_key='elm_finish_renovation_pool'
      and item.status='available' and (item.preferred_membership_id is null or item.preferred_membership_id=p_membership_id)
      and not exists (select 1 from atlas.project_pull_item_dependencies dependency join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
        where dependency.project_item_id=item.id and prerequisite.status<>dependency.required_status)
      and not exists (select 1 from atlas.project_pull_selections selection where selection.project_item_id=item.id and selection.state='selected');
  exception when others then v_warnings:=v_warnings||jsonb_build_array('finish_elm_suggestions_unavailable'); v_project:='[]'::jsonb;
  end;

  return jsonb_build_object('contractVersion','owner_worker_day_plan_v1','farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,
    'availableWorkerDay',true,'paidTargetMinutes',v_target,'committedPaidMinutes',v_committed,'automaticPaidMinutes',v_automatic_minutes,
    'remainingPaidMinutes',v_remaining,'realWork',v_real,'automaticWork',v_automatic,'suggestions',v_floating||v_project,'warnings',v_warnings);
end;
$$;

create or replace function atlas.owner_worker_day_plan_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not exists (select 1 from atlas.farm_memberships fm where fm.user_id=auth.uid() and fm.farm_id=p_farm_id and fm.active=true and fm.role in ('owner','manager')) then
    raise exception 'Owner or manager farm membership required.' using errcode='42501';
  end if;
  if not exists (select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  return atlas.owner_worker_day_plan_v1(p_farm_id,p_membership_id,p_day);
end;
$$;

revoke all on function atlas.owner_worker_day_plan_api_v1(uuid,uuid,date) from public;
grant execute on function atlas.owner_worker_day_plan_api_v1(uuid,uuid,date) to authenticated;
