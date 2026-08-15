do $patch$
declare d text; p text;
begin
  select pg_get_functiondef('atlas.sync_transplant_readiness_day_cue_v1(uuid)'::regprocedure) into d;
  p:=replace(
    d,
    E'      jsonb_build_object(\n        ''key'',''condition'',\n        ''when'',jsonb_build_object(''key'',''readiness'',''equals'',''ready''),\n        ''prompt'',''How did the seedlings make it?'',\n        ''choices'',jsonb_build_array(\n          jsonb_build_object(''label'',''They look great'',''value'',''all_great''),\n          jsonb_build_object(''label'',''Struggling but still there'',''value'',''struggling''),\n          jsonb_build_object(''label'',''Record number'',''value'',''record_number'')\n        )\n      ),\n      jsonb_build_object(\n        ''key'',''surviving_count'',\n        ''when'',jsonb_build_object(''key'',''condition'',''equals'',''record_number''),\n        ''input'',''number'',\n        ''prompt'',''How many seedlings are ready?'',\n        ''placeholder'',''Ready seedlings''\n      )',
    E'      jsonb_build_object(\n        ''key'',''surviving_count'',\n        ''when'',jsonb_build_object(''key'',''readiness'',''equals'',''ready''),\n        ''input'',''number'',\n        ''prompt'',''How many seedlings are ready to plant?'',\n        ''placeholder'',''Ready seedlings''\n      )'
  );
  if p=d then raise exception 'transplant readiness cue question seam drifted'; end if;
  execute p;

  select pg_get_functiondef('atlas.apply_worker_day_field_transplant_readiness_v1(uuid,jsonb)'::regprocedure) into d;
  p:=replace(
    d,
    E'  if v_readiness=''ready'' then\n    if v_condition not in (''all_great'',''struggling'',''record_number'') then\n      raise exception ''Record how the seedlings made it.'' using errcode=''22023'';\n    end if;\n    if v_condition=''record_number'' and (v_count is null or v_count<1) then\n      raise exception ''Enter the ready seedling count.'' using errcode=''22023'';\n    end if;\n  end if;',
    E'  if v_readiness=''ready'' then\n    if v_count is null or v_count<1 then\n      raise exception ''Enter the ready seedling count.'' using errcode=''22023'';\n    end if;\n    if v_condition='''' then\n      -- Compact worker interaction no longer asks a separate condition question.\n      -- Preserve the existing observation vocabulary internally so downstream\n      -- readers do not gain a second readiness-condition language.\n      v_condition:=''record_number'';\n    elsif v_condition not in (''all_great'',''struggling'',''record_number'') then\n      raise exception ''Seedling condition is invalid.'' using errcode=''22023'';\n    end if;\n  end if;'
  );
  if p=d then raise exception 'transplant readiness compact resolver seam drifted'; end if;
  execute p;
end $patch$;

select atlas.sync_transplant_readiness_day_cue_v1(task.id)
from atlas.tasks task
where task.task_type='transplant_readiness'
  and task.status='open'
  and task.metadata->>'observation_delivery_mode'='day_cue';