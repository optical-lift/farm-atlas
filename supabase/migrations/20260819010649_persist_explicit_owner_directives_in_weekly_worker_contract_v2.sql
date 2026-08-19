do $migration$
declare
  v_def text;
  v_old_promotion text := $$v_promoted := not v_original_required
      and v_protected
      and v_ready
      and coalesce(v_due, v_occurrence_target, v_week_end) <= v_week_end;
    v_required := v_original_required or v_promoted;$$;
  v_new_promotion text := $$v_promoted := not v_original_required
      and (
        (
          v_protected
          and v_ready
          and coalesce(v_due, v_occurrence_target, v_week_end) <= v_week_end
        )
        or (
          v_task.origin_kind='owner_assigned'
          and v_task.release_reason='manual_immediate'
          and nullif(v_task.metadata->>'owner_directive_date','') is not null
          and (v_task.metadata->>'owner_directive_date')::date <= v_week_end
        )
      );
    v_required := v_original_required or v_promoted;$$;
  v_old_reason text := $$if v_promoted then
      v_decorated := v_decorated || jsonb_build_object(
        'reasonCodes', coalesce(v_item->'reasonCodes','[]'::jsonb) || '["protected_farm_minimum"]'::jsonb
      );
    end if;$$;
  v_new_reason text := $$if v_promoted then
      v_decorated := v_decorated || jsonb_build_object(
        'reasonCodes', coalesce(v_item->'reasonCodes','[]'::jsonb) ||
          case
            when v_task.origin_kind='owner_assigned'
             and v_task.release_reason='manual_immediate'
             and nullif(v_task.metadata->>'owner_directive_date','') is not null
              then '["owner_directive_persistent"]'::jsonb
            else '["protected_farm_minimum"]'::jsonb
          end
      );
    end if;$$;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='worker_weekly_farm_contract_v5'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_anchor_day date';

  if v_def is null then raise exception 'worker_weekly_farm_contract_v5 definition not found'; end if;
  if position(v_old_promotion in v_def)=0 then raise exception 'Expected promotion fragment not found; migration aborted'; end if;
  if position(v_old_reason in v_def)=0 then raise exception 'Expected promotion reason fragment not found; migration aborted'; end if;

  v_def:=replace(v_def,v_old_promotion,v_new_promotion);
  v_def:=replace(v_def,v_old_reason,v_new_reason);
  execute v_def;
end;
$migration$;