-- Bloom Bar purchase dependency reconciliation v1
--
-- The Monday mail/card handoff was completed, but the Owner purchase task was
-- still manually blocked because the relationship lived only in prose. Promote
-- that relationship into the canonical prerequisite graph and let the existing
-- prerequisite reconciler release the purchase task from confirmed reality.

do $$
declare
  v_purchase atlas.tasks%rowtype;
  v_card_handoff atlas.tasks%rowtype;
begin
  select * into v_purchase
  from atlas.tasks task
  where task.title='Buy bloom-bar + coffee supplies'
    and task.status in ('open','blocked')
  order by task.created_at desc
  limit 1;

  select * into v_card_handoff
  from atlas.tasks task
  where task.metadata->>'task_key'='anna_20260810_check_mail_bank_envelope'
  order by task.created_at desc
  limit 1;

  if v_purchase.id is null or v_card_handoff.id is null then
    return;
  end if;
  if v_purchase.farm_id<>v_card_handoff.farm_id then
    raise exception 'Bloom Bar purchase dependency crosses farms.' using errcode='22023';
  end if;

  insert into atlas.task_prerequisites(
    id,farm_id,downstream_task_id,prerequisite_task_id,required_status,
    hold_mode,sequence_order,active,satisfied_at,metadata
  ) values (
    gen_random_uuid(),
    v_purchase.farm_id,
    v_purchase.id,
    v_card_handoff.id,
    'done',
    'blocked_visible',
    100,
    true,
    case when v_card_handoff.status='done' then now() else null end,
    jsonb_build_object(
      'reason','Owner purchase waits for the completed Monday mail/card handoff.',
      'source','bloom_bar_purchase_dependency_reconciliation_v1'
    )
  )
  on conflict (downstream_task_id,prerequisite_task_id) do update
  set required_status='done',
      hold_mode='blocked_visible',
      active=true,
      satisfied_at=case
        when v_card_handoff.status='done' then coalesce(atlas.task_prerequisites.satisfied_at,now())
        else null
      end,
      metadata=coalesce(atlas.task_prerequisites.metadata,'{}'::jsonb)
        || excluded.metadata,
      updated_at=now();

  update atlas.tasks task
  set note='Amazon cart is filled. Order exactly: 5 snips; 1 cold brew carafe; 1 milk carafe; brown sugar coffee syrup; strawberry coffee syrup; 1 tape dispenser.',
      metadata=(coalesce(task.metadata,'{}'::jsonb)-'waiting_on'-'waiting_until')
        || jsonb_build_object(
          'prerequisite_gate_restore',jsonb_build_object(
            'status','open',
            'due_date',task.due_date,
            'assigned_membership_id',task.assigned_membership_id,
            'assigned_user_id',task.assigned_user_id,
            'visibility_scope',task.visibility_scope,
            'blocker_text',null,
            'assigned_to',task.metadata->'assigned_to',
            'assignee_key',task.metadata->'assignee_key'
          ),
          'card_details_dependency_task_id',v_card_handoff.id,
          'card_details_dependency_reconciled_at',now()
        ),
      updated_at=now()
  where task.id=v_purchase.id;

  perform atlas.reconcile_task_prerequisite_gate_v1(v_purchase.id,now());
end;
$$;
