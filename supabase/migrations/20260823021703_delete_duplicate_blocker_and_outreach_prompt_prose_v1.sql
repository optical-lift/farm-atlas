update atlas.tasks t
set blocker_text=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('blocker_authority','structured_gate_or_prerequisite_v1'),
    updated_at=now()
where t.status not in ('done','archived','skipped')
  and nullif(btrim(t.blocker_text),'') is not null
  and t.blocker_text ~* '^Waiting for '
  and (
    exists(select 1 from atlas.task_prerequisites p where p.downstream_task_id=t.id and p.active)
    or exists(select 1 from atlas.work_execution_components c where c.task_id=t.id and c.component_role='gate')
  );

update atlas.tasks
set metadata=coalesce(metadata,'{}'::jsonb)-'network_log_prompt',
    updated_at=now()
where status not in ('done','archived','skipped')
  and nullif(metadata->>'network_log_prompt','') is not null
  and coalesce(metadata->>'result_storage','')='atlas.buyer_contact_events'
  and coalesce((metadata->>'network_log_enabled')::boolean,false);