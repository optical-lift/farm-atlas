-- Bring the six Entry Billboard clear/relocate jobs into the persistent Weed family.
-- The task identity and serial dates remain intact; the specific bed-reset work becomes a Weed directive.

do $$
declare
  v_farm atlas.farms%rowtype;
  v_anna atlas.farm_memberships%rowtype;
  v_owner atlas.farm_memberships%rowtype;
  v_n integer;
  v_object uuid;
  v_card uuid;
  v_task uuid;
  v_directive uuid;
  v_due date;
  v_label text;
  v_step text;
  v_position integer;
begin
  select * into v_farm from atlas.farms where stable_key='elm_farm';
  select * into v_anna from atlas.farm_memberships where farm_id=v_farm.id and active and worker_key='anna' order by created_at limit 1;
  select * into v_owner from atlas.farm_memberships where farm_id=v_farm.id and active and role='owner' order by created_at limit 1;

  for v_n in 1..6 loop
    select id,label into v_object,v_label
    from atlas.growing_objects
    where farm_id=v_farm.id and stable_key='eb_sunflower_'||v_n::text
    limit 1;

    select id into v_card from atlas.weed_cards where farm_id=v_farm.id and object_id=v_object limit 1;
    select id,due_date into v_task,v_due
    from atlas.tasks
    where farm_id=v_farm.id and metadata->>'task_key'='anna_entry_billboard_reset_eb'||v_n::text||'_20260818'
    order by created_at limit 1;

    if v_object is null or v_card is null or v_task is null then continue; end if;

    update atlas.tasks
    set title='Weed Entry Billboard Bed '||v_n::text,
        task_type='maintenance',
        action_key='weed',
        operation_class='remove_uproot',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'work_route','weed',
          'work_rhythm','Weed',
          'display_action','Weed',
          'canonical_card_family','weed',
          'canonical_weed_title',true,
          'weed_card_managed',true,
          'weed_card_session_task',true,
          'weed_card_id',v_card,
          'clear_relocate_directive',true,
          'owner_directive_date','2026-08-18'
        ),
        updated_at=now()
    where id=v_task;

    insert into atlas.maintenance_directives(
      organization_id,farm_id,object_id,maintenance_kind,weed_card_id,
      directive_kind,title,instructions,effect_policy,target_condition,
      assigned_membership_id,due_date,status,serving_task_id,idempotency_key,
      created_by_user_id,metadata
    ) values (
      v_farm.organization_id,v_farm.id,v_object,'weed',v_card,
      'instruction','Clear + Relocate',
      'Clear the sprayed/dead material and relocate usable excess mulch/compost instead of returning it to the Entry Billboard bed.',
      'full_maintenance','clear',v_anna.id,v_due,'active',v_task,
      'entry-billboard-clear-relocate:'||v_n::text||':2026',v_owner.user_id,
      jsonb_build_object('source','entry_billboard_clear_relocate_weed_cards_v3','bedNumber',v_n,'taskFamily','weed')
    )
    on conflict(farm_id,idempotency_key) do update
    set weed_card_id=excluded.weed_card_id,object_id=excluded.object_id,serving_task_id=excluded.serving_task_id,
        assigned_membership_id=excluded.assigned_membership_id,due_date=excluded.due_date,status='active',
        title=excluded.title,instructions=excluded.instructions,effect_policy=excluded.effect_policy,
        target_condition=excluded.target_condition,metadata=atlas.maintenance_directives.metadata||excluded.metadata,updated_at=now()
    returning id into v_directive;

    for v_position,v_step in
      select * from (values
        (10,'Clear dead sprayed biomass from the bed and adjacent walkway'),
        (20,'Remove excess loose mulch/compost while preserving usable soil'),
        (30,'Move usable excess to the repaired Curve Garden Arch 3 beds, then Follow Me Arch 2 right if needed'),
        (40,'Do not return relocated material to the Entry Billboard bed'),
        (50,'Reshape and level the bed and walkway')
      ) x(position,title)
    loop
      if not exists(select 1 from atlas.maintenance_directive_steps where directive_id=v_directive and position=v_position) then
        insert into atlas.maintenance_directive_steps(directive_id,position,title,metadata)
        values(v_directive,v_position,v_step,jsonb_build_object('source','entry_billboard_clear_relocate_weed_cards_v3'));
      else
        update atlas.maintenance_directive_steps
        set title=v_step,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source','entry_billboard_clear_relocate_weed_cards_v3')
        where directive_id=v_directive and position=v_position;
      end if;
    end loop;
  end loop;
end $$;
