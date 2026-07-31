-- Phase 1 stabilization, performance slice 2: wrap auth.uid() in scalar
-- subqueries for the eleven Atlas SELECT policies identified by the Supabase
-- performance advisor. This preserves each policy's row predicate while
-- allowing PostgreSQL to evaluate the request identity once per statement.
--
-- The migration does not combine permissive policies or change table grants.
-- Those broader policy-shape decisions remain outside this reviewed slice.

do $preflight$
declare
  expected record;
  current_policy record;
  normalized_qual text;
begin
  for expected in
    select * from (values
      ('user_profiles','user_profiles_read_self','(user_id = auth.uid())'),
      ('farm_memberships','farm_memberships_read_self','(user_id = auth.uid())'),
      ('organization_memberships','organization_memberships_read_self','(user_id = auth.uid())'),
      ('tasks','tasks_read_project_contributor','((assigned_user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM atlas.project_task_links ptl WHERE ((ptl.task_id = tasks.id) AND atlas.can_read_project(ptl.project_id)))))'),
      ('bell_event_receipts','bell_event_receipts_read_own','(user_id = auth.uid())'),
      ('bell_visit_state','bell_visit_state_read_own','(user_id = auth.uid())'),
      ('push_subscriptions','push_subscriptions_own_read','(user_id = auth.uid())'),
      ('notification_preferences','notification_preferences_own_read','(user_id = auth.uid())'),
      ('notification_outbox','notification_outbox_own_read','(user_id = auth.uid())'),
      ('notification_deliveries','notification_deliveries_own_read','(user_id = auth.uid())'),
      ('bell_monitoring_baselines','bell_monitoring_baselines_read_own','(user_id = auth.uid())')
    ) as reviewed(table_name,policy_name,expected_qual)
  loop
    select *
    into current_policy
    from pg_policies
    where schemaname = 'atlas'
      and tablename = expected.table_name
      and policyname = expected.policy_name;

    if not found then
      raise exception 'Reviewed Atlas policy %.% does not exist.',
        expected.table_name, expected.policy_name;
    end if;

    if current_policy.roles <> array['authenticated']::name[]
       or current_policy.cmd <> 'SELECT'
       or current_policy.permissive <> 'PERMISSIVE'
       or current_policy.with_check is not null then
      raise exception 'Reviewed Atlas policy %.% changed its role, command, permissiveness, or check contract.',
        expected.table_name, expected.policy_name;
    end if;

    normalized_qual := regexp_replace(current_policy.qual, E'\\s+', ' ', 'g');
    if normalized_qual <> expected.expected_qual then
      raise exception 'Reviewed Atlas policy %.% has drifted: %',
        expected.table_name, expected.policy_name, normalized_qual;
    end if;
  end loop;

  if has_table_privilege('authenticated','atlas.bell_monitoring_baselines','SELECT') then
    raise exception 'bell_monitoring_baselines unexpectedly became directly selectable by authenticated.';
  end if;
end
$preflight$;

alter policy user_profiles_read_self on atlas.user_profiles
  using (user_id = (select auth.uid()));

alter policy farm_memberships_read_self on atlas.farm_memberships
  using (user_id = (select auth.uid()));

alter policy organization_memberships_read_self on atlas.organization_memberships
  using (user_id = (select auth.uid()));

alter policy tasks_read_project_contributor on atlas.tasks
  using (
    assigned_user_id = (select auth.uid())
    or exists (
      select 1
      from atlas.project_task_links ptl
      where ptl.task_id = tasks.id
        and atlas.can_read_project(ptl.project_id)
    )
  );

alter policy bell_event_receipts_read_own on atlas.bell_event_receipts
  using (user_id = (select auth.uid()));

alter policy bell_visit_state_read_own on atlas.bell_visit_state
  using (user_id = (select auth.uid()));

alter policy push_subscriptions_own_read on atlas.push_subscriptions
  using (user_id = (select auth.uid()));

alter policy notification_preferences_own_read on atlas.notification_preferences
  using (user_id = (select auth.uid()));

alter policy notification_outbox_own_read on atlas.notification_outbox
  using (user_id = (select auth.uid()));

alter policy notification_deliveries_own_read on atlas.notification_deliveries
  using (user_id = (select auth.uid()));

alter policy bell_monitoring_baselines_read_own on atlas.bell_monitoring_baselines
  using (user_id = (select auth.uid()));

do $verification$
declare
  expected record;
  current_policy record;
  rewritten_back text;
begin
  for expected in
    select * from (values
      ('user_profiles','user_profiles_read_self','(user_id = auth.uid())'),
      ('farm_memberships','farm_memberships_read_self','(user_id = auth.uid())'),
      ('organization_memberships','organization_memberships_read_self','(user_id = auth.uid())'),
      ('tasks','tasks_read_project_contributor','((assigned_user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM atlas.project_task_links ptl WHERE ((ptl.task_id = tasks.id) AND atlas.can_read_project(ptl.project_id)))))'),
      ('bell_event_receipts','bell_event_receipts_read_own','(user_id = auth.uid())'),
      ('bell_visit_state','bell_visit_state_read_own','(user_id = auth.uid())'),
      ('push_subscriptions','push_subscriptions_own_read','(user_id = auth.uid())'),
      ('notification_preferences','notification_preferences_own_read','(user_id = auth.uid())'),
      ('notification_outbox','notification_outbox_own_read','(user_id = auth.uid())'),
      ('notification_deliveries','notification_deliveries_own_read','(user_id = auth.uid())'),
      ('bell_monitoring_baselines','bell_monitoring_baselines_read_own','(user_id = auth.uid())')
    ) as reviewed(table_name,policy_name,expected_original_qual)
  loop
    select *
    into current_policy
    from pg_policies
    where schemaname = 'atlas'
      and tablename = expected.table_name
      and policyname = expected.policy_name;

    if not found then
      raise exception 'Reviewed Atlas policy %.% disappeared.',
        expected.table_name, expected.policy_name;
    end if;

    if current_policy.roles <> array['authenticated']::name[]
       or current_policy.cmd <> 'SELECT'
       or current_policy.permissive <> 'PERMISSIVE'
       or current_policy.with_check is not null then
      raise exception 'Reviewed Atlas policy %.% changed outside its USING expression.',
        expected.table_name, expected.policy_name;
    end if;

    if position('SELECT auth.uid()' in current_policy.qual) = 0 then
      raise exception 'Reviewed Atlas policy %.% did not receive an auth.uid initPlan wrapper.',
        expected.table_name, expected.policy_name;
    end if;

    rewritten_back := regexp_replace(
      current_policy.qual,
      E'\\(\\s*SELECT\\s+auth\\.uid\\(\\)(\\s+AS\\s+uid)?\\s*\\)',
      'auth.uid()',
      'gi'
    );

    if regexp_replace(rewritten_back, E'\\s+', ' ', 'g')
       <> expected.expected_original_qual then
      raise exception 'Reviewed Atlas policy %.% changed semantics beyond wrapping auth.uid(): %',
        expected.table_name, expected.policy_name, current_policy.qual;
    end if;
  end loop;

  if has_table_privilege('authenticated','atlas.bell_monitoring_baselines','SELECT') then
    raise exception 'RLS optimization changed the grant-blocked bell_monitoring_baselines boundary.';
  end if;
end
$verification$;
