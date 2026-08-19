do $migration$
declare
  v_def text;
  v_old_select text := $$t.metadata as task_metadata,$$;
  v_new_select text := $$t.metadata as task_metadata,t.origin_kind,t.release_reason,$$;
  v_old_scope text := $$b.committed_in_week
        or b.due_date<=v_week_end$$;
  v_new_scope text := $$b.committed_in_week
        or (
          b.origin_kind='owner_assigned'
          and b.release_reason='manual_immediate'
          and nullif(b.task_metadata->>'owner_directive_date','') is not null
          and (b.task_metadata->>'owner_directive_date')::date<=v_week_end
        )
        or b.due_date<=v_week_end$$;
  v_old_required text := $$s.committed_in_week
        or s.hard_finish_date<=v_week_end$$;
  v_new_required text := $$s.committed_in_week
        or (
          s.origin_kind='owner_assigned'
          and s.release_reason='manual_immediate'
          and nullif(s.task_metadata->>'owner_directive_date','') is not null
          and (s.task_metadata->>'owner_directive_date')::date<=v_week_end
        )
        or s.hard_finish_date<=v_week_end$$;
  v_old_reason text := $$||case when c.committed_in_week then '["committed_clock_placement"]'::jsonb else '[]'::jsonb end
       ||case when c.hard_finish_date<=v_week_end then$$;
  v_new_reason text := $$||case when c.committed_in_week then '["committed_clock_placement"]'::jsonb else '[]'::jsonb end
       ||case when c.origin_kind='owner_assigned' and c.release_reason='manual_immediate' and nullif(c.task_metadata->>'owner_directive_date','') is not null then '["owner_directive_persistent"]'::jsonb else '[]'::jsonb end
       ||case when c.hard_finish_date<=v_week_end then$$;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='worker_weekly_farm_contract_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_anchor_day date';

  if v_def is null then raise exception 'worker_weekly_farm_contract_v1 definition not found'; end if;
  if position(v_old_select in v_def)=0 then raise exception 'candidate select fragment not found'; end if;
  if position(v_old_scope in v_def)=0 then raise exception 'scope fragment not found'; end if;
  if position(v_old_required in v_def)=0 then raise exception 'required fragment not found'; end if;
  if position(v_old_reason in v_def)=0 then raise exception 'reason fragment not found'; end if;

  v_def:=replace(v_def,v_old_select,v_new_select);
  v_def:=replace(v_def,v_old_scope,v_new_scope);
  v_def:=replace(v_def,v_old_required,v_new_required);
  v_def:=replace(v_def,v_old_reason,v_new_reason);
  execute v_def;
end;
$migration$;